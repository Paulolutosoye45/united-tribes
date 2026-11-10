import { flat, num, shortDay, smsLine, str, meetsText } from "./format";
import type { Context, Params, TemplateDef } from "./types";

/**
 * The notices: email to the office, pastors, directors, coaches, the care team, leaders, community champions, members, applicants
 * and referees. The database (supabase/migrations/20261225000100_notices.sql and 20261225000200_notice_triggers.sql) decides who is told
 * what and when, and puts what the wording needs in `params`. This file turns that into an email.
 *
 * Rules the wording keeps, and the tests check:
 *   - first names, counts and times only. Never a note, a score, a referee's words, a reason, a care word, a sealed note, or anything
 *     about a young member
 *   - one idea and one button
 *   - a subject that fits on a phone's lock screen (under 80 characters) and says what it is about, with no name in the ones
 *     that are about a concern or a request to be forgotten
 *   - the button goes to the page where the thing is done; the email never carries the thing itself
 *
 * These are email only: they are never put to Meta for approval, and the database only ever queues them as email.
 */

export type NoticeGroupKey =
  | "admin" | "pastors" | "directors" | "care" | "coaches" | "leaders" | "champions" | "data_lead" | "members" | "applicants" | "referees";

/** What the Notifications page says about each group of notices. */
export const NOTICE_GROUPS: { key: NoticeGroupKey; label: string; who: string; digest: boolean; note: string }[] = [
  { key: "admin", label: "Admins", who: "Everyone with the admin role", digest: true, note: "Deletion requests, messages not going out, role changes, the launch checklist." },
  { key: "pastors", label: "Pastors", who: "Everyone with the pastor role", digest: true, note: "Applications ready for a decision, Tribe Cards to review, changes to a leader’s stage of life, concerns raised by a referee." },
  { key: "directors", label: "Directors", who: "Everyone with the director role", digest: true, note: "Interviews, offers, members waiting for a leader, the countdown to a season." },
  { key: "care", label: "Care team", who: "The care lead; the directors if there is none; the admins if there are none", digest: true, note: "Call-backs due, a parent's permission waiting for its call, people who asked for someone to reach out. Never a name or a reason." },
  { key: "coaches", label: "Coaches", who: "Everyone with the coach role", digest: true, note: "A new leader, a Tribe Card submitted, a leader ready for a practice assessment or stuck, a leader who has not confirmed their details." },
  { key: "leaders", label: "Leaders", who: "The leader of a tribe, and its assistant", digest: false, note: "Their card approved or sent back, certification, seats, workshops, the question of next season." },
  { key: "champions", label: "Community champions", who: "The champion of each community", digest: false, note: "Their community's month, and members waiting there." },
  { key: "data_lead", label: "Data lead", who: "Everyone with the data lead role", digest: false, note: "Integrity flags and held references of the week, the reporting copy, the week's email." },
  { key: "members", label: "Members", who: "Members of a tribe (never anyone under 18)", digest: false, note: "A changed meeting, a shared testimony, and the answers to a deletion request." },
  { key: "applicants", label: "Applicants", who: "People applying to lead", digest: false, note: "A reference came in, a referee has not answered, the application is still with us." },
  { key: "referees", label: "Referees", who: "People named as a referee, by address", digest: false, note: "A reminder before the link stops working, and thanks." },
];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const clean = (v: unknown, fallback: string) => str(v).replace(/\s+/g, " ").trim() || fallback;
const count = (p: Params, key = "count", fallback = 1) => Math.max(0, Math.round(num(p[key], fallback)));
const many = (n: number, one: string, plural = `${one}s`) => `${n} ${n === 1 ? one : plural}`;
const is = (n: number) => (n === 1 ? "is" : "are");
const has = (n: number) => (n === 1 ? "has" : "have");
const roleLabel = (v: unknown, fallback = "team") => str(v).replace(/_/g, " ").trim() || fallback;
/** The page a button opens: the database says which, and only a path on our own site is ever used. */
const target = (p: Params, c: Context, fallback: string) => {
  const path = str(p.path);
  return c.link(/^\/[A-Za-z0-9/_-]*$/.test(path) && !path.startsWith("//") ? path : fallback);
};
const when = (p: Params) => clean(p.starts_at_label, "") || (str(p.starts_at) ? shortDay(str(p.starts_at)) : "");
const roleBlurb: Record<string, string> = {
  pastor: "You decide leader applications and approve Tribe Cards.",
  director: "You look after the leader pipeline, interviews and the season.",
  admin: "You look after settings, people and the launch of each season.",
  coach: "You walk with the leaders you are given.",
  care_lead: "You look after the people who need someone to reach out.",
  data_lead: "You look after the reports and the checks on the data.",
};

type Spec = {
  key: string;
  audience: TemplateDef["audience"];
  group: NoticeGroupKey;
  title: string;
  /** Who receives it, in a phrase for the Notifications page. */
  who: string;
  /** When it is sent, in a phrase for the Notifications page. */
  when: string;
  /** Sent at once even when the person chose a digest. */
  urgent?: boolean;
  subject: (p: Params) => string;
  body: (p: Params, c: Context) => string[];
  button?: { label: string | ((p: Params) => string); path: string };
  sample: Params;
  /** Leave out the greeting (a message to an address we know no name for). */
  noGreeting?: boolean;
};

const SPECS: Spec[] = [];
const add = (s: Spec) => {
  SPECS.push(s);
};

// ---------------------------------------------------------------------------
// Pastors
// ---------------------------------------------------------------------------

add({
  key: "pastor_decision_ready", audience: "office", group: "pastors", title: "An application is ready for a pastor's decision",
  who: "Pastors", when: "When an applicant's interview is done",
  subject: () => "An application is ready for your decision",
  body: (p) => [
    `${clean(p.applicant, "An applicant")}’s application has been through the interview and is ready for a pastor’s decision.`,
    ...(count(p, "waiting", 1) > 1 ? [`${count(p, "waiting", 1)} applications are waiting for a decision in all.`] : []),
    "A pastor decides every application. No certificate is given until one has.",
  ],
  button: { label: "Open the application", path: "/review" },
  sample: { applicant: "Ngozi", waiting: 3, path: "/review" },
});

add({
  key: "pastor_decision_overdue", audience: "office", group: "pastors", title: "Applications are waiting a long time for a decision",
  who: "Pastors", when: "Once a week, while an interviewed application has waited more than 7 days",
  subject: (p) => `${many(count(p), "application")} waiting for a decision`,
  body: (p) => [
    `${many(count(p), "application")} ${has(count(p))} waited ${count(p, "days", 7)} days or more for a pastor’s decision.`,
    "People who have been interviewed are waiting to hear. A clear answer, even a hard one, is kinder than waiting.",
  ],
  button: { label: "Open the review list", path: "/review" },
  sample: { count: 2, days: 9, path: "/review" },
});

add({
  key: "pastor_referee_concern", audience: "office", group: "pastors", title: "A referee raised a concern", urgent: true,
  who: "Pastors", when: "At once, whatever their digest setting",
  subject: () => "A referee raised a concern",
  body: () => [
    "A referee has raised a concern about an application that is waiting for review.",
    "What they wrote is not in this email. It is on the review page, where only the pastors can read it.",
  ],
  button: { label: "Read it on the review page", path: "/review" },
  sample: { path: "/review" },
});

add({
  key: "pastor_reference_held", audience: "office", group: "pastors", title: "A reference is held for a look",
  who: "Pastors", when: "When the checks hold a reference back",
  subject: () => "A reference is held for a look",
  body: () => [
    "A reference has been held back for a person to look at before it counts.",
    "The reason is on the page, not in this email.",
  ],
  button: { label: "Look at it", path: "/admin/referees" },
  sample: { path: "/admin/referees" },
});

add({
  key: "pastor_card_review", audience: "office", group: "pastors", title: "A Tribe Card is ready for review",
  who: "Pastors and directors", when: "When a leader sends in a Tribe Card",
  subject: (p) => `${clean(p.tribe, "A Tribe Card")} is ready for review`,
  body: (p) => [
    `${clean(p.leader, "A leader")} has sent in the Tribe Card for ${clean(p.tribe, "a tribe")}.`,
    "Members cannot see the tribe until a pastor has reviewed and approved it.",
  ],
  button: { label: "Review the card", path: "/review/cards" },
  sample: { tribe: "Builders Tribe", leader: "Ngozi", path: "/review/cards" },
});

add({
  key: "pastor_card_waiting", audience: "office", group: "pastors", title: "A Tribe Card has waited a day for review",
  who: "Pastors and directors", when: "Once, a day after a leader sent in the Tribe Card of a group the Leader Desk formed",
  subject: (p) => `${clean(p.tribe, "A Tribe Card")} is still waiting for review`,
  body: (p) => [
    `${clean(p.leader, "A leader")} sent in the Tribe Card for ${clean(p.tribe, "a tribe")} a day ago, and it has not been reviewed yet.`,
    "The group has members waiting to be told they have a tribe, and they cannot be placed until a pastor has approved the card.",
  ],
  button: { label: "Review the card", path: "/review/cards" },
  sample: { tribe: "Builders Tribe", leader: "Ngozi", path: "/review/cards" },
});

add({
  key: "pastor_card_overdue", audience: "office", group: "pastors", title: "Tribe Cards are waiting for review",
  who: "Pastors", when: "Once a week, while a card has waited more than 5 days",
  subject: (p) => `${many(count(p), "Tribe Card")} waiting for review`,
  body: (p) => [
    `${many(count(p), "Tribe Card")} ${has(count(p))} waited ${count(p, "days", 5)} days or more.`,
    "Members cannot join a tribe until its card is approved, so the season waits on this.",
  ],
  button: { label: "Review the cards", path: "/review/cards" },
  sample: { count: 2, days: 6, path: "/review/cards" },
});

add({
  key: "pastor_templates_waiting", audience: "office", group: "pastors", title: "Ready-made cards are waiting for sign-off",
  who: "Pastors", when: "Mondays, while any ready-made card is still a draft",
  subject: (p) => `${count(p, "count", 0)} ready-made cards wait for sign-off`,
  body: (p) => [
    `${count(p, "count", 0)} ready-made Tribe Cards${count(p, "communities", 0) > 0 ? `, across ${many(count(p, "communities", 0), "community", "communities")},` : ""} are still drafts.`,
    "A ready-made card is only offered to leaders after a pastor has read it and signed it off.",
  ],
  button: { label: "Open the ready-made cards", path: "/review/templates" },
  sample: { count: 100, communities: 10, path: "/review/templates" },
});

add({
  key: "pastor_fit_model_waiting", audience: "office", group: "pastors", title: "A new fit model is waiting for approval",
  who: "Pastors", when: "When a new version of the model is saved",
  subject: () => "A new fit model is waiting for approval",
  body: () => [
    "A new version of the model that suggests which leaders fit which tribes has been saved.",
    "It is not used until a pastor approves it.",
  ],
  button: { label: "Open the model", path: "/growth/model" },
  sample: { path: "/growth/model" },
});

add({
  key: "pastor_stage_review", audience: "office", group: "pastors", title: "A leader asked to change their stage of life",
  who: "Pastors and directors of the leader’s centre", when: "When a leader whose tribe has members asks to change their stage",
  subject: (p) => `${clean(p.leader, "A leader")} asked to change their ${clean(p.what, "stage of life").toLowerCase()}`,
  body: (p) => [
    `${clean(p.leader, "A leader")} asked to change their ${clean(p.what, "stage of life").toLowerCase()}. Their tribe has members, so the change waits for a pastor.`,
    "Until you decide, nothing changes and nobody is moved. If you approve, the tribe moves to the new stage; the people already in it stay where they are.",
  ],
  button: { label: "Open the change", path: "/review/stages" },
  sample: { leader: "Ngozi", what: "Stage of life", path: "/review/stages" },
});

add({
  key: "pastor_season_review", audience: "office", group: "pastors", title: "A season ends in two weeks",
  who: "Pastors", when: "14 days before a season ends",
  subject: (p) => `${clean(p.season, "The season")} ends in 14 days`,
  body: (p) => [
    `${clean(p.season, "The season")} ends on ${shortDay(str(p.ends_on)) || "its last day"}.`,
    "Before then, decide which tribes continue, which multiply and which rest.",
  ],
  button: { label: "Open the season decisions", path: "/growth/multiply" },
  sample: { season: "Season 1, 2027", ends_on: "2027-05-08", path: "/growth/multiply" },
});

// ---------------------------------------------------------------------------
// Directors
// ---------------------------------------------------------------------------

add({
  key: "director_interview_booked", audience: "office", group: "directors", title: "An interview was booked",
  who: "Directors, and whoever opened the time", when: "When an applicant books an interview time",
  subject: () => "An interview was booked",
  body: (p) => [
    `${clean(p.applicant, "An applicant")} has booked an interview${when(p) ? ` for ${when(p)}` : ""}${count(p, "minutes", 0) > 0 ? `, ${count(p, "minutes", 0)} minutes` : ""}${str(p.mode) === "online" ? ", online" : str(p.place) ? `, at ${clean(p.place, "")}` : ""}.`,
    "Make sure the applicant has what they need.",
  ],
  button: { label: "See the interviews", path: "/review/interviews" },
  sample: { applicant: "Ngozi", starts_at: "2027-03-09T15:00:00+00:00", minutes: 30, mode: "online", path: "/review/interviews" },
});

add({
  key: "director_interviews_tomorrow", audience: "office", group: "directors", title: "Interviews tomorrow",
  who: "Directors", when: "In the evening before",
  subject: (p) => `Tomorrow: ${many(count(p), "interview")}`,
  body: (p) => [
    `${many(count(p), "interview")} tomorrow${str(p.on) ? `, ${shortDay(str(p.on))}` : ""}.`,
    "Check that everyone who is interviewing is ready and each applicant has the link or the place.",
  ],
  button: { label: "See the interviews", path: "/review/interviews" },
  sample: { count: 3, on: "2027-03-10", path: "/review/interviews" },
});

add({
  key: "director_interview_no_outcome", audience: "office", group: "directors", title: "An interview has no outcome recorded",
  who: "Directors, and whoever opened the time", when: "Two hours after an interview ends with no outcome",
  subject: (p) => `${clean(p.first_name, "An applicant")}’s interview has no outcome yet`,
  body: (p) => [
    `${clean(p.first_name, "An applicant")}’s interview${when(p) ? ` on ${when(p)}` : ""} has ended and no outcome is recorded.`,
    "Record how it went while it is fresh, so the pastors can decide.",
  ],
  button: { label: "Record the outcome", path: "/review/interviews" },
  sample: { first_name: "Ngozi", starts_at: "2027-03-09T15:00:00+00:00", path: "/review/interviews" },
});

add({
  key: "director_slots_low", audience: "office", group: "directors", title: "Interview times are running out",
  who: "Directors", when: "Daily, while more applicants are invited than there are open times",
  subject: (p) => `Only ${count(p, "open", 0)} interview times left`,
  body: (p) => [
    `${many(count(p, "invited", 0), "applicant")} ${is(count(p, "invited", 0))} waiting for an interview time, and only ${count(p, "open", 0)} ${count(p, "open", 0) === 1 ? "time is" : "times are"} open.`,
    "Add more times so no one waits.",
  ],
  button: { label: "Add interview times", path: "/review/interviews" },
  sample: { open: 2, invited: 6, path: "/review/interviews" },
});

add({
  key: "director_offer_answered", audience: "office", group: "directors", title: "A leader offer was answered",
  who: "Directors", when: "When an offer is accepted or declined",
  subject: (p) => `${clean(p.person, "Someone")} ${str(p.answer) === "accepted" ? "accepted" : "declined"} a leader offer`,
  body: (p) => [
    `${clean(p.person, "Someone")} has ${str(p.answer) === "accepted" ? "accepted" : "declined"} the offer to lead.`,
    "The leader supply page shows where this leaves the goal.",
  ],
  button: { label: "Open the leader supply", path: "/admin/leader-supply" },
  sample: { person: "Tunde", answer: "accepted", path: "/admin/leader-supply" },
});

add({
  key: "director_offer_unanswered", audience: "office", group: "directors", title: "An offer has had no answer",
  who: "Directors", when: "Once, when an offer has had no answer for 5 days",
  subject: (p) => `An offer to ${clean(p.leader_first, "a leader")} has had no answer`,
  body: (p) => [
    `${clean(p.leader_first, "A leader")} was asked to lead “${clean(p.goal, "a goal")}” ${count(p, "days", 5)} days ago and has not answered yet.`,
    "A kind nudge may help.",
  ],
  button: { label: "Open the leader supply", path: "/admin/leader-supply" },
  sample: { leader_first: "Tunde", goal: "Step into a leadership role", days: 5, path: "/admin/leader-supply" },
});

add({
  key: "director_demand_gap", audience: "office", group: "directors", title: "Members are waiting where no leader is ready",
  who: "Directors", when: "Mondays, while 8 or more members wait for a goal with no seat open",
  subject: (p) => `${count(p, "count", 0)} members are waiting for a tribe with no leader`,
  body: (p) => [
    `${count(p, "count", 0)} members are waiting, across ${many(count(p, "goals", 1), "goal")}, and no leader is ready for them.${str(p.goal) ? ` The biggest gap is “${clean(p.goal, "")}”.` : ""}`,
    "Offering the goal to a leader who is ready is the quickest way to close it.",
  ],
  button: { label: "Open the leader supply", path: "/admin/leader-supply" },
  sample: { count: 21, goals: 2, goal: "Start a business", path: "/admin/leader-supply" },
});

add({
  key: "director_unplaced", audience: "office", group: "directors", title: "Members finished the form and have no tribe",
  who: "Directors", when: "Mondays",
  subject: (p) => `${many(count(p, "count", 0), "member")} still ${count(p, "count", 0) === 1 ? "has" : "have"} no tribe`,
  body: (p) => [
    `${many(count(p, "count", 0), "member")} finished the form over a week ago and ${is(count(p, "count", 0))} still not in a tribe.`,
    "Some may need a gentle call. Some may be waiting for a tribe that does not exist yet.",
  ],
  button: { label: "Open the dashboard", path: "/dashboard" },
  sample: { count: 7, path: "/dashboard" },
});

add({
  key: "director_season_countdown", audience: "office", group: "directors", title: "A season is about to open",
  who: "Directors", when: "14, 7 and 2 days before a season opens, while launch steps are open",
  subject: (p) => `${clean(p.season, "The season")} opens in ${count(p, "days", 0)} days`,
  body: (p) => [
    `${clean(p.season, "The season")} opens in ${count(p, "days", 0)} days and ${many(count(p, "left", 0), "launch step")} ${is(count(p, "left", 0))} still open.`,
  ],
  button: { label: "See the launch steps", path: "/admin" },
  sample: { season: "Season 1, 2027", days: 7, left: 3, path: "/admin/seasons" },
});

add({
  key: "director_removal_escalated", audience: "office", group: "directors", title: "A request about a member's place has waited a week", urgent: true,
  who: "Directors", when: "At once, once a leader's request about a member's place has waited 7 days without an answer",
  subject: () => "A request about a member’s place has waited a week",
  body: () => [
    "A leader’s request about a member’s place in their tribe has waited a week without an answer. The Care Team has been told as well.",
    "Nothing has happened to the member: silence never removes anyone. The leader is waiting to hear, so please make sure someone decides.",
  ],
  button: { label: "Open the request", path: "/growth/removals" },
  sample: { path: "/growth/removals" },
});

// ---------------------------------------------------------------------------
// Admins and the data lead
// ---------------------------------------------------------------------------

add({
  key: "admin_application_sent", audience: "office", group: "admin", title: "A new leader application was sent", urgent: true,
  who: "Admins and directors, not the person who applied", when: "At once, when someone sends their leader application",
  subject: () => "A new leader application was sent",
  body: (p) => [
    `${clean(p.applicant, "Someone")} has sent a leader application.`,
    ...(count(p, "waiting", 1) > 1 ? [`${count(p, "waiting", 1)} applications have been sent and are waiting to be invited to an interview.`] : []),
    str(p.path) === "/review"
      ? "An interview can be offered once both references are in and two reviewers have scored it. A pastor decides every application."
      : "The pastors and directors review it. The figures page shows how many applications have come in.",
  ],
  button: { label: (p) => (str(p.path) === "/review" ? "Open the applications" : "See the figures"), path: "/review" },
  sample: { applicant: "Ngozi", waiting: 3, path: "/review" },
});

add({
  key: "admin_data_request", audience: "office", group: "admin", title: "A deletion request came in",
  who: "Admins and directors, not the person asking", when: "When someone asks for their information to be deleted",
  subject: () => "A deletion request came in",
  body: () => [
    "Someone has asked for their information to be deleted.",
    "We promise to answer within 30 days. The page shows who asked and what is in the way, if anything.",
  ],
  button: { label: "Open the request", path: "/admin/privacy" },
  sample: { path: "/admin/privacy" },
});

add({
  key: "admin_data_request_due", audience: "office", group: "admin", title: "A deletion request is nearly due", urgent: true,
  who: "Admins (and directors in the last two days)", when: "At once, 7 and 2 days before the 30-day deadline",
  subject: (p) => `A deletion request is due in ${count(p, "days", 0)} days`,
  body: (p) => [
    `A deletion request is close to its 30-day deadline. ${many(count(p, "days", 0), "day")} left.`,
    "If it cannot be done, decline it with a reason, so the person is told.",
  ],
  button: { label: "Open the request", path: "/admin/privacy" },
  sample: { days: 7, path: "/admin/privacy" },
});

add({
  key: "admin_messages_failing", audience: "office", group: "admin", title: "Messages are failing",
  who: "Admins", when: "When many messages fail in an hour (at most once in six hours)",
  subject: (p) => `${many(count(p, "count", 0), "message")} failed in the last hour`,
  body: (p) => [
    `${many(count(p, "count", 0), "message")} failed to send in the last hour. That is more than usual.`,
    "It is usually the email service or a wrong setting. The message log says what each one answered.",
  ],
  button: { label: "Open the message log", path: "/admin/messages" },
  sample: { count: 14, path: "/admin/messages" },
});

add({
  key: "admin_queue_stuck", audience: "office", group: "admin", title: "Messages are not going out", urgent: true,
  who: "Admins", when: "At once, when messages have waited more than an hour (at most every three hours)",
  subject: () => "Messages are not going out",
  body: (p) => [
    `${many(count(p, "count", 0), "message")} ${has(count(p, "count", 0))} been waiting more than an hour to be sent.`,
    "The sending service may have stopped. Please check the system page.",
  ],
  button: { label: "Open the system page", path: "/admin/system" },
  sample: { count: 12, path: "/admin/system" },
});

add({
  key: "admin_role_changed", audience: "office", group: "admin", title: "Someone's role changed", urgent: true,
  who: "Admins, not the person concerned", when: "At once, when a staff role is given or taken away",
  subject: (p) => `${clean(p.person, "Someone")}: ${roleLabel(p.role)} role ${str(p.change) === "removed" ? "removed" : "added"}`,
  body: (p) => [
    `${clean(p.person, "Someone")} was ${str(p.change) === "removed" ? "taken off" : "given"} the ${roleLabel(p.role)} role${str(p.by) ? ` by ${clean(p.by, "")}` : ""}.`,
    "If you did not expect this, check the people page.",
  ],
  button: { label: "Open the people page", path: "/admin/people" },
  sample: { person: "Tunde", role: "pastor", change: "added", by: "Mary", path: "/admin/people" },
});

add({
  key: "admin_email_health", audience: "office", group: "admin", title: "How the week's email went",
  who: "Admins and the data lead", when: "Mondays",
  subject: (p) => `This week’s email: ${count(p, "sent", 0)} sent, ${count(p, "failed", 0)} failed`,
  body: (p) => [
    `Last week ${many(count(p, "sent", 0), "email")} ${is(count(p, "sent", 0)) === "is" ? "was" : "were"} sent, ${count(p, "failed", 0)} failed and ${many(count(p, "unsubscribed", 0), "person", "people")} unsubscribed.`,
    "A rise in failures or in people unsubscribing is worth a look before the next announcement.",
  ],
  button: { label: "Open the message log", path: "/admin/messages" },
  sample: { sent: 1240, failed: 6, unsubscribed: 3, path: "/admin/messages" },
});

add({
  key: "admin_reporting_failed", audience: "office", group: "admin", title: "The reporting copy did not refresh",
  who: "Admins and the data lead", when: "Daily, when last night's copy did not refresh",
  subject: () => "The reporting copy did not refresh",
  body: () => [
    "The nightly copy that feeds the reports did not refresh.",
    "The reports may be out of date until it does. Nothing else is affected.",
  ],
  button: { label: "Open the system page", path: "/admin/system" },
  sample: { path: "/admin/system" },
});

add({
  key: "admin_checklist_overdue", audience: "office", group: "admin", title: "Launch steps are still open before a season",
  who: "Admins", when: "Every day in the last 14 days before a season opens, while steps are open",
  subject: (p) => `${clean(p.season, "The season")}: ${many(count(p, "left", 0), "launch step")} open, ${count(p, "days", 0)} days to go`,
  body: (p) => [
    `${many(count(p, "left", 0), "launch step")} ${is(count(p, "left", 0))} still open, and ${clean(p.season, "the season")} opens in ${count(p, "days", 0)} days.`,
  ],
  button: { label: "Open the launch steps", path: "/admin/seasons" },
  sample: { season: "Season 1, 2027", left: 3, days: 6, path: "/admin/seasons" },
});

add({
  key: "data_integrity_week", audience: "office", group: "data_lead", title: "The week's integrity flags and held references",
  who: "The data lead", when: "Mondays, when there is something to look at",
  subject: (p) => `${many(count(p, "flags", 0), "integrity flag")} and ${many(count(p, "holds", 0), "held reference")} this week`,
  body: (p) => [
    `This week the checks raised ${many(count(p, "flags", 0), "integrity flag")}, and ${many(count(p, "holds", 0), "reference")} ${is(count(p, "holds", 0)) === "is" ? "was" : "were"} held for a look.`,
    "Clearing them keeps the numbers and the references honest.",
  ],
  button: { label: "Open the list", path: "/admin/referees" },
  sample: { flags: 4, holds: 2, path: "/admin/referees" },
});

add({
  key: "data_unusual_export", audience: "office", group: "data_lead", title: "An unusual number of named files",
  who: "The data lead", when: "When one person makes more than the set number of named files in an hour",
  subject: (p) => `${many(count(p, "count", 6), "named file")} in an hour from one ${roleLabel(p.role, "person")}`,
  body: (p) => [
    `One ${roleLabel(p.role, "person")} made ${many(count(p, "count", 6), "named file")} in the last hour. The notice is set for more than ${count(p, "per_hour", 5)}. The latest was the ${clean(p.pack, "named file")}.`,
    "It may be perfectly ordinary. If you have any doubt, ask them, and tell the owner, who can limit the file.",
  ],
  button: { label: "Open the admin hub", path: "/admin" },
  sample: { count: 6, per_hour: 5, pack: "Tribe sheet", role: "leader", path: "/admin" },
});

// ---------------------------------------------------------------------------
// Coaches
// ---------------------------------------------------------------------------

add({
  key: "coach_new_leader", audience: "coach", group: "coaches", title: "A leader was given to you",
  who: "The coach", when: "When a coach is given a leader",
  subject: (p) => `${clean(p.leader, "A leader")} is now one of your leaders`,
  body: (p) => [
    `${clean(p.leader, "A leader")} leads ${clean(p.tribe, "a tribe")} and you are their coach.`,
    "Say hello this week. The first month sets the tone.",
  ],
  button: { label: "Open their card", path: "/review/cards" },
  sample: { leader: "Ngozi", tribe: "Builders Tribe", path: "/review/cards" },
});

add({
  key: "coach_practice_ready", audience: "coach", group: "coaches", title: "A leader is ready for a practice assessment",
  who: "The leader's coach (every coach if there is none)", when: "When a leader has passed every Academy module",
  subject: (p) => `${clean(p.leader, "A leader")} is ready for a practice assessment`,
  body: (p) => [
    `${clean(p.leader, "A leader")} has passed every Academy module.`,
    "The next step is a practice assessment with you.",
  ],
  button: { label: "Open the Academy page", path: "/review/academy" },
  sample: { leader: "Ngozi", path: "/review/academy" },
});

add({
  key: "coach_card_submitted", audience: "coach", group: "coaches", title: "A leader sent in a Tribe Card",
  who: "The tribe's coach", when: "When a leader sends in a Tribe Card",
  subject: (p) => `${clean(p.leader, "A leader")} sent in a Tribe Card`,
  body: (p) => [
    `${clean(p.leader, "A leader")} has sent ${clean(p.tribe, "their tribe")} for review. The pastors will look at it next.`,
    `You may want to check in with ${clean(p.leader, "them")} while they wait.`,
  ],
  button: { label: "Open the card", path: "/review/cards" },
  sample: { leader: "Ngozi", tribe: "Builders Tribe", path: "/review/cards" },
});

add({
  key: "coach_details_unanswered", audience: "coach", group: "coaches", title: "A leader has not answered the check of their details",
  who: "The leader’s coach", when: "A week after the church asked a leader to confirm their details, if they have not answered",
  subject: (p) => `Please speak to ${clean(p.leader, "your leader")} about their details`,
  body: (p) => [
    `${clean(p.leader, "Your leader")} has not yet confirmed the details we hold for their tribe, a week after the church asked.`,
    "A word from you usually does more than another message. It takes them under a minute.",
  ],
  button: { label: "Open my leaders", path: "/coach" },
  sample: { leader: "Ngozi", path: "/coach" },
});

add({
  key: "coach_leader_stalled", audience: "coach", group: "coaches", title: "A leader has stopped moving in the Academy",
  who: "The leader's coach", when: "Weekly, while a leader has not moved in the Academy for 14 days",
  subject: (p) => `${clean(p.leader_first, "A leader")} has not moved in the Academy`,
  body: (p) => [
    `${clean(p.leader_first, "A leader")} has not moved forward in the Academy for ${count(p, "days", 14)} days.`,
    "A short call usually helps more than a reminder.",
  ],
  button: { label: "Open the Academy page", path: "/review/academy" },
  sample: { leader_first: "Ngozi", days: 14, path: "/review/academy" },
});

add({
  key: "coach_removal_ask", audience: "coach", group: "coaches", title: "A leader has asked about a member's place",
  who: "The coach of the tribe (not for the requests only the Care Team handles)", when: "When a leader asks the church to change a member's place in their tribe, and when they answer a question put to them",
  subject: (p) => (p.again === true ? "A leader answered your question" : "A leader has asked about a member’s place"),
  body: (p) =>
    p.again === true
      ? ["A leader has answered the question put to them about a member’s place in their tribe.", "Their answer is on the page, not in this email. When you have read it, you can change what you would do."]
      : [
          "One of your leaders has asked the church to change a member’s place in their tribe. As their coach, you know them best, so the church would like to hear what you would do.",
          "What the leader wrote is on the page, not in this email. You can say whether you would approve it, decline it or ask the leader a question first. An admin, a director or the Care Lead then decides, and reads what you wrote first. Nothing happens to the member until they do.",
        ],
  button: { label: "Open the request", path: "/growth/removals" },
  sample: { path: "/growth/removals" },
});

add({
  key: "admin_removal_ask", audience: "office", group: "admin", title: "A leader has asked about a member's place",
  who: "Admins and directors (not the leader who asked)", when: "When a leader asks the church to change a member's place in their tribe, and when they answer a question put to them",
  subject: (p) => (p.again === true ? "A leader answered a question about a member’s place" : "A leader has asked about a member’s place"),
  body: (p) =>
    p.again === true
      ? ["A leader has answered the question put to them about a member’s place in their tribe.", "The answer is on the page, not in this email."]
      : [
          "A leader has asked the church to change a member’s place in their tribe. An admin, a director or the Care Lead decides.",
          "What the leader wrote is on the page, not in this email, and so is what the coach would do. Nothing happens to the member until someone decides.",
        ],
  button: { label: "Open the request", path: "/growth/removals" },
  sample: { path: "/growth/removals" },
});

add({
  key: "admin_removal_waiting", audience: "office", group: "admin", title: "A request about a member's place is waiting for a decision",
  who: "Admins and directors", when: "Once, when a request has waited 3 days without an answer",
  subject: () => "A request about a member’s place has waited three days",
  body: () => [
    "A leader’s request about a member’s place in their tribe has waited three days for a decision.",
    "Nothing has happened to the member while it waits, and the leader is waiting to hear. If you cannot decide, you can ask the leader a question.",
  ],
  button: { label: "Open the request", path: "/growth/removals" },
  sample: { level: "reminder", path: "/growth/removals" },
});

add({
  key: "admin_placement_answer", audience: "office", group: "admin", title: "The owner answered your request to place a member",
  who: "The admin or director who asked the owner", when: "When the owner approves or declines a request to place or move a member",
  subject: (p) => (p.approved === true ? "The owner approved your request to place a member" : "The owner has answered your request to place a member"),
  body: (p) =>
    p.approved === true
      ? [
          "The owner approved your request, and the member has been placed. They have been emailed like anyone the church places, and the leader of the tribe is told in the usual way.",
          "You can undo it from the member’s page until the leader has been told.",
        ]
      : [
          "The owner has not approved your request, so nothing has changed for the member.",
          "The owner’s words, if there are any, are on the member’s page. You can ask again if something changes.",
        ],
  button: { label: "Open the member", path: "/admin/people" },
  sample: { approved: true, path: "/admin/people" },
});

add({
  key: "admin_placement_lapsed", audience: "office", group: "admin", title: "Your request to the owner lapsed",
  who: "The admin or director who asked the owner", when: "Once, when a request to place or move a member has waited 7 days without an answer",
  subject: () => "Your request to place a member lapsed",
  body: (p) => [
    `Your request about ${clean(p.member_first, "a member")} was not answered within 7 days, so it lapsed. Nothing has changed for the member.`,
    "If it still matters, you can ask the owner again from the member’s page.",
  ],
  button: { label: "Open the member", path: "/admin/people" },
  sample: { member_first: "Tobi", path: "/admin/people" },
});

add({
  key: "coach_removal_waiting", audience: "coach", group: "coaches", title: "A request about a member's place is waiting for you",
  who: "The coach of the tribe", when: "Once, when a request has waited 3 days without an answer",
  subject: () => "A request about a member’s place has waited three days",
  body: () => [
    "A request from one of your leaders about a member’s place in their tribe has waited three days for an answer.",
    "Nothing has happened to the member while it waits, and the leader is waiting to hear. If you have not yet said what you would do, the person deciding will read it first.",
  ],
  button: { label: "Open the request", path: "/growth/removals" },
  sample: { level: "reminder", path: "/growth/removals" },
});

// ---------------------------------------------------------------------------
// The care team (never a name, an age or a reason)
// ---------------------------------------------------------------------------

add({
  key: "care_callbacks_due", audience: "care", group: "care", title: "Referee call-backs are due",
  who: "The care team", when: "Mondays, while call-backs are due that week",
  subject: (p) => `${many(count(p, "count", 0), "referee call-back")} due this week`,
  body: (p) => [
    `${many(count(p, "count", 0), "referee call-back")} ${is(count(p, "count", 0))} due this week.`,
    "The list shows who to call and what to ask.",
  ],
  button: { label: "Open the call-backs", path: "/care/referees" },
  sample: { count: 4, path: "/care/referees" },
});

add({
  key: "care_teen_confirm", audience: "care", group: "care", title: "A parent's permission is waiting for its call",
  who: "The care team", when: "When a parent or guardian has given permission",
  subject: () => "A permission is waiting for its confirmation call",
  body: () => [
    "A parent or guardian has given permission, and it needs a confirmation call before it counts.",
    "The details are on the page, not in this email.",
  ],
  button: { label: "Open the requests", path: "/care/teens" },
  sample: { path: "/care/teens" },
});

add({
  key: "care_age_ask", audience: "care", group: "care", title: "Someone says their age range is not right",
  who: "The care team", when: "When a person tells the Care Team their age range is wrong in a way the list cannot fix",
  subject: () => "Someone says their age range is not right",
  body: () => [
    "A person has told the Care Team that their age range is not right. Nothing has been changed for them.",
    "The page has what they wrote. The young people’s rules say who speaks to them, and to a parent or guardian.",
  ],
  button: { label: "Open the requests", path: "/care/teens" },
  sample: { path: "/care/teens" },
});

add({
  key: "care_asks_waiting", audience: "care", group: "care", title: "People have asked for someone to reach out",
  who: "The care team", when: "Daily, once a request has waited 2 days",
  subject: (p) => `${many(count(p, "count", 0), "person", "people")} asked for someone to reach out`,
  body: (p) => [
    `${many(count(p, "count", 0), "person", "people")} ${count(p, "count", 0) === 1 ? "has" : "have"} asked for someone to reach out and ${count(p, "count", 0) === 1 ? "is" : "are"} still waiting.`,
    "A short, warm reply makes a big difference.",
  ],
  button: { label: "Open the requests", path: "/care/asks" },
  sample: { count: 3, path: "/care/asks" },
});

add({
  key: "care_removal_ask", audience: "care", group: "care", title: "A leader has asked about a member's place",
  who: "The care team", when: "When a leader asks the church to change a member's place in their tribe, and when they answer a question put to them",
  subject: (p) => (p.again === true ? "A leader answered a question about a member’s place" : "A leader has asked about a member’s place"),
  body: (p) =>
    p.again === true
      ? ["A leader has answered the question put to them about a member’s place in their tribe.", "The answer is on the page, not in this email."]
      : [
          "A leader has asked the church to change a member’s place in their tribe. The Care Team always sees these.",
          "The request is on the page, not in this email. The Care Lead, a director or an admin may decide it, and the page shows what the coach would do. Nothing happens to the member until someone decides.",
        ],
  button: { label: "Open the request", path: "/growth/removals" },
  sample: { path: "/growth/removals" },
});

add({
  key: "care_removal_waiting", audience: "care", group: "care", title: "A request about a member's place is still waiting",
  who: "The care team", when: "When a request has waited 3 days, and again at 7 days (when the director is told as well)",
  subject: (p) => (p.level === "escalated" ? "A request about a member’s place has waited a week" : "A request about a member’s place has waited three days"),
  body: (p) =>
    p.level === "escalated"
      ? [
          "A leader’s request about a member’s place in their tribe has now waited a week. The director has been told as well.",
          "Nothing has happened to the member: silence never removes anyone. The leader is waiting to hear.",
        ]
      : [
          "A leader’s request about a member’s place in their tribe has waited three days for an answer.",
          "Nothing has happened to the member while it waits. If the coach cannot decide, the Care Team can.",
        ],
  button: { label: "Open the request", path: "/growth/removals" },
  sample: { level: "reminder", path: "/growth/removals" },
});

add({
  key: "care_removal_appeal", audience: "care", group: "care", title: "A member has asked for a decision to be looked at again",
  who: "The care team", when: "When a member whose place in a tribe was changed asks the Care Lead to look again (they have 14 days)",
  subject: () => "A member has asked for a decision to be looked at again",
  body: () => [
    "A member whose place in a tribe was changed has asked the Care Team to look at the decision again.",
    "What they wrote is on the page, not in this email. You can keep the decision, or put their place back, and either way they and the leader are told.",
  ],
  button: { label: "Open the request", path: "/growth/removals" },
  sample: { path: "/growth/removals" },
});

// ---------------------------------------------------------------------------
// Leaders
// ---------------------------------------------------------------------------

add({
  key: "leader_card_approved", audience: "leader", group: "leaders", title: "Your Tribe Card was approved",
  who: "The tribe's leader", when: "When the pastors approve the card",
  subject: (p) => `${clean(p.tribe, "Your Tribe Card")} was approved`,
  body: (p) => [`The pastors have approved your Tribe Card for ${clean(p.tribe, "your tribe")}.`, "Thank you for the care you put into it."],
  button: { label: "Open my tribe", path: "/lead/tribe" },
  sample: { tribe: "Builders Tribe", path: "/lead/tribe" },
});

add({
  key: "leader_card_changes", audience: "leader", group: "leaders", title: "Your Tribe Card needs a few changes",
  who: "The tribe's leader", when: "When the pastors ask for changes",
  subject: (p) => `${clean(p.tribe, "Your Tribe Card")} needs a few changes`,
  body: (p) => [
    `The pastors have asked for a few changes to your Tribe Card for ${clean(p.tribe, "your tribe")}.`,
    "Their note is on the card in the app, not in this email. Change what they asked and send it in again.",
  ],
  button: { label: "Open my card", path: "/lead/tribe" },
  sample: { tribe: "Builders Tribe", path: "/lead/tribe" },
});

add({
  key: "leader_certified", audience: "leader", group: "leaders", title: "You are certified",
  who: "The leader", when: "When the certificate is given",
  subject: () => "You are certified",
  body: (p) => [
    `You are now certified as ${str(p.as_role) === "assistant_leader" ? "an assistant leader" : "a leader"}.`,
    "Thank you for finishing the Academy.",
  ],
  button: { label: "Open my page", path: "/lead" },
  sample: { as_role: "leader", path: "/lead" },
});

add({
  key: "leader_tribe_open", audience: "leader", group: "leaders", title: "Your tribe is open to members",
  who: "The tribe's leader", when: "When the card is approved and the leader is certified",
  subject: (p) => `${clean(p.tribe, "Your tribe")} is open to members`,
  body: (p) => [
    `${clean(p.tribe, "Your tribe")} is approved and you are certified, so members can now join.`,
    "You will hear when someone does.",
  ],
  button: { label: "Open my tribe", path: "/lead/tribe" },
  sample: { tribe: "Builders Tribe", path: "/lead/tribe" },
});

add({
  key: "leader_academy_next", audience: "leader", group: "leaders", title: "Your next Academy step",
  who: "The leader", when: "Weekly, while a leader in training has not moved for 7 days",
  subject: (p) => `Your next Academy step: ${clean(p.step, "keep going")}`,
  body: (p) => [`Your next step in the Academy is ${clean(p.step, "the next module")}.`, "A little each week is enough."],
  button: { label: "Open the Academy", path: "/lead/academy" },
  sample: { step: "Module 3", path: "/lead/academy" },
});

add({
  key: "leader_workshop_tomorrow", audience: "leader", group: "leaders", title: "A workshop is tomorrow",
  who: "Leaders booked on it", when: "The evening before",
  subject: (p) => `Tomorrow: ${clean(p.workshop, "your workshop")}`,
  body: (p) => [`${clean(p.workshop, "Your workshop")} is tomorrow${when(p) ? `, ${when(p)}` : ""}.`, "Arrive a few minutes early."],
  button: { label: "Open the Academy", path: "/lead/academy" },
  sample: { workshop: "the practice workshop", starts_at: "2027-03-09T15:00:00+00:00", path: "/lead/academy" },
});

add({
  key: "leader_seats", audience: "leader", group: "leaders", title: "Seats are nearly gone",
  who: "The tribe's leader", when: "When two seats are left, and when the tribe is full",
  subject: (p) => (count(p, "seats_left", 2) === 0 ? `${clean(p.tribe, "Your tribe")} is full` : `${clean(p.tribe, "Your tribe")} has ${many(count(p, "seats_left", 2), "seat")} left`),
  body: (p) => [
    count(p, "seats_left", 2) === 0 ? `${clean(p.tribe, "Your tribe")} is full.` : `${clean(p.tribe, "Your tribe")} has ${many(count(p, "seats_left", 2), "seat")} left.`,
    count(p, "seats_left", 2) === 0 ? "No one else can join this season unless a seat opens." : "Say hello to each new member within three days.",
  ],
  button: { label: "Open my tribe", path: "/lead/tribe" },
  sample: { tribe: "Builders Tribe", seats_left: 2, path: "/lead/tribe" },
});

add({
  key: "leader_assistant_added", audience: "leader", group: "leaders", title: "An assistant was added to your tribe",
  who: "The tribe's leader", when: "When an assistant is added",
  subject: (p) => `${clean(p.assistant, "Someone")} is now your assistant`,
  body: (p) => [
    `${clean(p.assistant, "Someone")} has been added as the assistant leader of ${clean(p.tribe, "your tribe")}.`,
    "Share the weekly rhythm with them, so they can lead if you cannot.",
  ],
  button: { label: "Open my tribe", path: "/lead/tribe" },
  sample: { assistant: "Tunde", tribe: "Builders Tribe", path: "/lead/tribe" },
});

add({
  key: "leader_next_season", audience: "leader", group: "leaders", title: "Next season: continue, multiply or rest?",
  who: "Leaders and assistants of an open tribe", when: "21 days before the season ends",
  subject: () => "Next season: continue, multiply or rest?",
  body: (p) => [
    `${clean(p.season, "The season")} ends in three weeks.`,
    "Before then, tell us whether your tribe will continue, multiply or rest, so the pastors can plan.",
  ],
  button: { label: "Tell us", path: "/lead" },
  sample: { season: "Season 1, 2027", path: "/lead" },
});

// ---------------------------------------------------------------------------
// Community champions
// ---------------------------------------------------------------------------

add({
  key: "champion_month", audience: "leader", group: "champions", title: "Your community this month",
  who: "The community champion", when: "On the 1st of the month",
  subject: (p) => `${clean(p.community, "Your community")} this month`,
  body: (p) => [
    `${clean(p.community, "Your community")} has ${many(count(p, "tribes", 0), "tribe")} and ${many(count(p, "members", 0), "member")}${count(p, "waiting", 0) > 0 ? `, and ${count(p, "waiting", 0)} ${count(p, "waiting", 0) === 1 ? "person is" : "people are"} waiting for a tribe` : ""}.`,
  ],
  button: { label: "Open my community", path: "/community" },
  sample: { community: "Professionals", tribes: 4, members: 41, waiting: 5, path: "/community" },
});

add({
  key: "champion_waiting", audience: "leader", group: "champions", title: "Members are waiting in your community",
  who: "The community champion", when: "Mondays, while 8 or more are waiting",
  subject: (p) => `${many(count(p, "count", 0), "person", "people")} waiting in ${clean(p.community, "your community")}`,
  body: (p) => [
    `${many(count(p, "count", 0), "person", "people")} ${count(p, "count", 0) === 1 ? "is" : "are"} waiting for a tribe in ${clean(p.community, "your community")}.`,
    "If you know someone who could lead one, now is a good time to invite them.",
  ],
  button: { label: "Open my community", path: "/community" },
  sample: { community: "Professionals", count: 9, path: "/community" },
});

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

add({
  key: "member_meeting_changed", audience: "member", group: "members", title: "Your tribe's meeting has changed",
  who: "The tribe's members", when: "Once the change has been quiet for 30 minutes",
  subject: (p) => `${clean(p.tribe, "Your tribe")}: the meeting has changed`,
  body: (p) => [
    `${clean(p.tribe, "Your tribe")} now meets ${meetsText(p)}.`,
    ...(str(p.mode) === "online" && str(p.meeting_link) ? [`Meeting link: ${str(p.meeting_link)}`] : []),
  ],
  button: { label: "See my tribe", path: "/tribe" },
  sample: { tribe: "Builders Tribe", meeting_day: 3, meeting_time: "20:00", mode: "online", meeting_link: "https://meet.example.org/abc-defg", path: "/tribe" },
});

add({
  key: "member_testimony_shared", audience: "member", group: "members", title: "Your testimony was shared",
  who: "The person who wrote it", when: "When it is approved to be shared",
  subject: () => "Your testimony was shared",
  body: (p) => [
    `Your testimony has been approved and shared with ${str(p.shared_with) === "church" ? "the church" : "your tribe"}.`,
    "Thank you for telling it. Someone will be encouraged by it.",
  ],
  button: { label: "Open my testimonies", path: "/tribe/testimony" },
  sample: { shared_with: "tribe", path: "/tribe/testimony" },
});

add({
  key: "member_deletion_received", audience: "member", group: "members", title: "We received your deletion request",
  who: "The person who asked", when: "When they ask for their information to be deleted",
  subject: () => "We received your deletion request",
  body: () => [
    "We have received your request to delete your information.",
    "The office will answer within 30 days, and will write to you when it is done.",
  ],
  button: { label: "See my request", path: "/profile" },
  sample: { path: "/profile" },
});

add({
  key: "member_deletion_done", audience: "member", group: "members", title: "Your information has been deleted",
  who: "The person who asked, at the address they used", when: "At the moment it is done. The address is wiped after it is sent",
  subject: () => "Your information has been deleted",
  body: () => [
    "Your information has been deleted from United Tribes, as you asked.",
    "This is the last email you will receive from us. We wish you well.",
  ],
  sample: { first_name: "Ada" },
});

// ---------------------------------------------------------------------------
// Applicants and referees
// ---------------------------------------------------------------------------

add({
  key: "applicant_reference_in", audience: "applicant", group: "applicants", title: "A reference has come in",
  who: "The applicant", when: "When a referee sends their reference",
  subject: () => "A reference has come in",
  body: (p) => [
    `${clean(p.referee, "One of your referees")} has sent their reference.`,
    "References are read only by the people who decide on your application.",
  ],
  button: { label: "See my application", path: "/lead/apply" },
  sample: { referee: "Pastor", path: "/lead/apply" },
});

add({
  key: "applicant_referee_slow", audience: "applicant", group: "applicants", title: "A referee has not answered yet",
  who: "The applicant", when: "Once a referee has not answered for 5 days",
  subject: (p) => `${clean(p.referee_first, "A referee")} has not answered yet`,
  body: (p) => [
    `${clean(p.referee_first, "A referee")} has not sent their reference yet.`,
    "A short message from you often helps. Their email may be in a spam folder.",
  ],
  button: { label: "See my application", path: "/lead/apply" },
  sample: { referee_first: "Pastor", path: "/lead/apply" },
});

add({
  key: "applicant_still_with_us", audience: "applicant", group: "applicants", title: "Your application is still with us",
  who: "The applicant", when: "Once an application has stayed at one stage for 14 days",
  subject: () => "Your application is still with us",
  body: () => [
    "Your application is still being looked at.",
    "Nothing is wrong. It has been a while since the last step, and we wanted you to know it has not been forgotten.",
  ],
  button: { label: "See where it is", path: "/lead/apply" },
  sample: { path: "/lead/apply" },
});

add({
  key: "referee_reminder", audience: "referee", group: "referees", title: "A reminder before the reference link stops working",
  who: "The referee, by address", when: "3 days and 1 day before the link stops working, if they have not answered",
  subject: (p) => `A reminder: ${clean(p.applicant_first, "someone")} is waiting for your reference`,
  body: (p) => [
    `${clean(p.applicant_first, "Someone")} named you as a referee, and the link we sent you stops working in ${many(count(p, "days", 3), "day")}.`,
    "The link is in the first email we sent you. Please look for it in your inbox, and in your spam folder. It takes about five minutes.",
  ],
  sample: { applicant_first: "Ngozi", days: 3 },
});

add({
  key: "referee_thanks", audience: "referee", group: "referees", title: "Thank you for your reference",
  who: "The referee, by address", when: "When they send their reference",
  subject: () => "Thank you for your reference",
  body: () => [
    "Thank you for the reference you sent. It means a great deal to the person who named you.",
    "We keep what you wrote private to the people who decide on the application.",
  ],
  sample: {},
});

// ---------------------------------------------------------------------------
// Staff: welcome, escalation
// ---------------------------------------------------------------------------

add({
  key: "staff_role_welcome", audience: "office", group: "admin", title: "You now hold a new role", urgent: true,
  who: "The person given a staff role", when: "At once, when a staff role is given",
  subject: (p) => `You now hold the ${roleLabel(p.role)} role`,
  body: (p) => [
    `You have been given the ${roleLabel(p.role)} role.`,
    roleBlurb[str(p.role)] ?? "Open Admin to see what is waiting for you.",
    "When something needs you, you will get a short email, or a daily summary if you prefer. You can choose in your profile, under My notices.",
  ],
  button: { label: "Open Admin", path: "/admin" },
  sample: { role: "pastor", path: "/admin" },
});

add({
  key: "staff_escalation", audience: "office", group: "directors", title: "Something has waited too long",
  who: "Directors", when: "Once a week, while an application has waited 14 days or a Tribe Card 10",
  subject: (p) => `${count(p)} ${clean(p.what, "things waiting")}`,
  body: (p) => [
    `${count(p)} ${clean(p.what, "things waiting")}: the oldest has waited ${count(p, "days", 14)} days.`,
    "It is passed to you because it has gone a long time without an answer.",
  ],
  button: { label: "Open it", path: "/admin" },
  sample: { what: "applications waiting for a pastor’s decision", count: 3, days: 16, path: "/review" },
});

// ---------------------------------------------------------------------------
// The digest: one email for a person's day or week, a part for each role they hold
// ---------------------------------------------------------------------------

type DigestSection = { title: string; items: { label: string; path: string; age: number }[] };
const sectionsOf = (p: Params): DigestSection[] =>
  (Array.isArray(p.sections) ? (p.sections as unknown[]) : []).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const o = raw as Record<string, unknown>;
    const items = (Array.isArray(o.items) ? (o.items as unknown[]) : []).flatMap((it) => {
      if (!it || typeof it !== "object") return [];
      const i = it as Record<string, unknown>;
      return clean(i.label, "") ? [{ label: clean(i.label, ""), path: str(i.path), age: Math.max(0, Math.round(num(i.age, 0))) }] : [];
    });
    return items.length > 0 ? [{ title: clean(o.title, "Team"), items }] : [];
  });

const staffDigest: TemplateDef = {
  key: "staff_digest",
  audience: "office",
  title: "Your daily or weekly summary of what is waiting",
  emailOnly: true,
  email: (p, c) => {
    const sections = sectionsOf(p);
    const total = Math.max(sections.reduce((n, s) => n + s.items.length, 0), count(p, "total", 0));
    const weekly = str(p.period) === "weekly";
    const more = count(p, "more", 0);
    return {
      subject: weekly ? `Your week: ${many(total, "thing")} waiting` : `${many(total, "thing")} waiting for you`,
      greeting: `Hi ${c.first},`,
      paragraphs: [
        weekly ? "Here is what is waiting for you this week." : "Here is what is waiting for you today.",
        ...(sections.length > 1 ? ["You hold more than one role, so this is everything in one place, with a part for each."] : []),
        ...(more > 0 ? [`And ${more} more. Open Admin to see them all.`] : []),
        `You can choose how often you hear from us in your profile, under My notices: ${c.link("/profile")}`,
      ],
      sections: sections.map((s) => ({
        title: s.title,
        items: s.items.map((i) => ({ label: i.label, url: target({ path: i.path }, c, "/admin"), note: i.age > 0 ? `${many(i.age, "day")}` : "" })),
      })),
      cta: { label: "Open Admin", url: c.link("/admin") },
    };
  },
  sms: (p, c) => smsLine(`${many(count(p, "total", 0), "thing")} waiting for you.`, c.link("/admin")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, a note from United Tribes for your role in the team: {{2}} waiting for you. You can open it here: {{3}}",
    example: ["Ada", "3 things are", "https://unitedtribes.example/admin"],
    vars: [flat(c.first), flat(`${many(count(p, "total", 0), "thing")} ${is(count(p, "total", 0))}`), flat(c.link("/admin"))],
  }),
};

// ---------------------------------------------------------------------------
// Turning each spec into a template
// ---------------------------------------------------------------------------

function toTemplate(s: Spec): TemplateDef {
  return {
    key: s.key,
    audience: s.audience,
    title: s.title,
    emailOnly: true,
    email: (p, c) => ({
      subject: s.subject(p),
      ...(s.noGreeting ? {} : { greeting: `Hi ${c.first},` }),
      paragraphs: s.body(p, c),
      ...(s.button ? { cta: { label: typeof s.button.label === "function" ? s.button.label(p) : s.button.label, url: target(p, c, s.button.path) } } : {}),
    }),
    sms: (p, c) => smsLine(s.subject(p), s.button ? target(p, c, s.button.path) : undefined),
    whatsapp: (p, c) => ({
      body: "Hi {{1}}, a note from United Tribes for your role in the team: {{2}} You can open it here: {{3}}",
      example: ["Ada", s.subject(s.sample), c.link(s.button?.path ?? "/admin")],
      vars: [flat(c.first), flat(s.subject(p)), flat(s.button ? target(p, c, s.button.path) : c.site)],
    }),
  };
}

/** Every notice, as a template. */
export const NOTICE_TEMPLATES: TemplateDef[] = [...SPECS.map(toTemplate), staffDigest];

/** What the Notifications page lists: each notice, who gets it, when, and an example. */
export type NoticeInfo = { key: string; group: NoticeGroupKey | "digest"; title: string; who: string; when: string; urgent: boolean };
export const NOTICE_CATALOGUE: NoticeInfo[] = [
  ...SPECS.map((s) => ({ key: s.key, group: s.group, title: s.title, who: s.who, when: s.when, urgent: Boolean(s.urgent) })),
  { key: "staff_digest", group: "digest", title: staffDigest.title, who: "Everyone on the team who has something waiting", when: "Once a day (or Mondays, if they chose weekly), between 7 am and 8 pm", urgent: false },
];

/** Believable fields for each notice, as the database supplies them: for the examples on the Notifications page and for the tests. */
export const NOTICE_SAMPLES: Record<string, Params> = {
  ...Object.fromEntries(SPECS.map((s) => [s.key, s.sample])),
  staff_digest: {
    period: "daily",
    total: 4,
    more: 0,
    sections: [
      { group: "admin", title: "Admin", items: [{ label: "A deletion request came in", path: "/admin/privacy", age: 1 }] },
      {
        group: "pastors",
        title: "Pastor",
        items: [
          { label: "An application is ready for your decision", path: "/review", age: 0 },
          { label: "Builders Tribe is ready for review", path: "/review/cards", age: 2 },
          { label: "A reference is held for a look", path: "/admin/referees", age: 0 },
        ],
      },
    ],
  },
};

import { ROLES, ROLE_LABELS, type Role } from "@/lib/auth/roles";

/**
 * The owner's map of the platform by who uses it: for each kind of person, what their day is for, the screens they work from, and the
 * live numbers they would be looking at. The screens are the real ones: the owner opens every one of them, and sees everything on them
 * (a coach sees only their own tribes; the owner sees all of them). The numbers come from `god_desks()`.
 */

export type DeskItem = { title: string; href: string; what: string };
export type DeskCount = { key: string; label: string; href?: string };
export type Desk = {
  role: Role;
  label: string;
  /** What this person is there to do, in one sentence. */
  watches: string;
  counts: DeskCount[];
  items: DeskItem[];
};

const DESKS: Record<Role, Omit<Desk, "role" | "label">> = {
  member: {
    watches: "Finding a tribe, showing up each week and checking in.",
    counts: [
      { key: "members_total", label: "people on the platform" },
      { key: "members_seated", label: "seated in a tribe" },
      { key: "members_waiting", label: "waiting for a tribe", href: "/admin/leader-supply" },
    ],
    items: [
      { title: "Home", href: "/home", what: "Where the week starts: the tribe, the next meeting, the Friday check-in." },
      { title: "My tribe", href: "/tribe", what: "The group, its members and its weeks." },
      { title: "Community", href: "/community", what: "The community they chose and what is happening in it." },
      { title: "Testimonies", href: "/testimonies", what: "What others have shared." },
      { title: "Profile", href: "/profile", what: "How they are reached and what they have agreed to." },
    ],
  },
  leader: {
    watches: "Running a tribe: the Tribe Card, the weekly log, the Academy, a member to call.",
    counts: [
      { key: "leaders_without_tribe", label: "leaders with no tribe", href: "/admin/leader-supply" },
      { key: "tribes_in_draft", label: "Tribe Cards being written" },
      { key: "leader_offers_open", label: "offers to lead waiting", href: "/admin/leader-supply" },
    ],
    items: [
      { title: "Lead a tribe", href: "/lead", what: "Their application, or an offer to lead where members are waiting." },
      { title: "My Tribe Card", href: "/lead/tribe", what: "The goal, the Success Picture and the meeting." },
      { title: "This week", href: "/lead/week", what: "The week’s plan, the call list and the log." },
      { title: "Academy", href: "/lead/academy", what: "The training and the safeguarding declaration." },
      { title: "Progress", href: "/lead/progress", what: "How the tribe is doing across the season." },
    ],
  },
  assistant_leader: {
    watches: "Helping a leader: the week, the members, and being ready to lead.",
    counts: [],
    items: [
      { title: "This week", href: "/lead/week", what: "The week’s plan alongside the leader." },
      { title: "My tribe", href: "/tribe", what: "The group they assist." },
    ],
  },
  coach: {
    watches: "Looking after leaders: who missed a log, who needs help, who wants to change tribe.",
    counts: [
      { key: "tribes_without_coach", label: "approved tribes with no coach" },
      { key: "swaps_open", label: "requests to change tribe", href: "/growth/swaps" },
    ],
    items: [
      { title: "Dashboard", href: "/dashboard", what: "Their tribes at a glance." },
      { title: "Weekly report", href: "/review/rhythm", what: "Which tribes held a meeting and how it felt." },
      { title: "Tribe changes", href: "/growth/swaps", what: "Members who asked to move." },
      { title: "Growth", href: "/growth", what: "Multiplying tribes and what comes next season." },
    ],
  },
  community_champion: {
    watches: "A community of interest: how many are in it, which goals, what to report.",
    counts: [{ key: "communities_without_champion", label: "communities with no champion", href: "/admin/champions" }],
    items: [
      { title: "My community", href: "/community", what: "The community they look after." },
      { title: "Reports", href: "/reports", what: "The reports they are given." },
      { title: "Dashboard", href: "/dashboard", what: "Numbers for their community." },
    ],
  },
  care_lead: {
    watches: "People who need a call: care tasks, concerns, young people and their guardians.",
    counts: [
      { key: "care_tasks_open", label: "care tasks open", href: "/care" },
      { key: "care_flags_open", label: "concerns open", href: "/care" },
    ],
    items: [
      { title: "Care", href: "/care", what: "Tasks, concerns and who has been called." },
      { title: "Asks", href: "/care/asks", what: "Members who asked for care." },
      { title: "Young people", href: "/care/teens", what: "Parent and guardian permission, and the confirming call." },
      { title: "Referees", href: "/care/referees", what: "References that need a look." },
    ],
  },
  data_lead: {
    watches: "Whether the platform is working: the numbers, the reports and the messages reaching people.",
    counts: [
      { key: "messages_failed_7d", label: "messages failed this week", href: "/admin/messages" },
      { key: "messages_queued", label: "messages waiting to go", href: "/admin/messages" },
    ],
    items: [
      { title: "Dashboard", href: "/dashboard", what: "The whole church’s numbers." },
      { title: "Reports", href: "/reports", what: "Monthly reports." },
      { title: "Weekly report", href: "/review/rhythm", what: "How the weeks are going." },
      { title: "Targets", href: "/admin/targets", what: "The targets the numbers are measured against." },
      { title: "Messages", href: "/admin/messages", what: "What was sent and what failed." },
      { title: "Leader supply", href: "/admin/leader-supply", what: "Where members wait for a leader." },
    ],
  },
  director: {
    watches: "The programme: seasons, the catalogue, tribe changes, growth and the leader pipeline.",
    counts: [
      { key: "seasons_live", label: "seasons open or running", href: "/admin/seasons" },
      { key: "swaps_open", label: "requests to change tribe", href: "/growth/swaps" },
      { key: "leader_seats_needed", label: "leader seats needed", href: "/admin/leader-supply" },
    ],
    items: [
      { title: "Admin", href: "/admin", what: "Everything the office runs." },
      { title: "Seasons", href: "/admin/seasons", what: "Creating and moving seasons." },
      { title: "Leader supply", href: "/admin/leader-supply", what: "Where members wait, who could lead, offers." },
      { title: "Tribe changes", href: "/growth/swaps", what: "Moves between tribes." },
      { title: "Multiplication", href: "/growth/multiply", what: "What happens to each tribe next season." },
      { title: "Dashboard", href: "/dashboard", what: "The whole church’s numbers." },
    ],
  },
  pastor: {
    watches: "Deciding: who leads, which cards are right, which tribes begin.",
    counts: [
      { key: "applications_in_review", label: "leader applications in review", href: "/review" },
      { key: "tribes_to_review", label: "Tribe Cards to review", href: "/review/cards" },
      { key: "cards_waiting_sign_off", label: "ready-made cards waiting", href: "/review/templates" },
      { key: "leader_seats_needed", label: "leader seats needed", href: "/admin/leader-supply" },
    ],
    items: [
      { title: "Review leaders", href: "/review", what: "Applications to read and decide." },
      { title: "Tribe Cards", href: "/review/cards", what: "Cards sent for a pastor’s approval." },
      { title: "Ready-made cards", href: "/review/templates", what: "The 100 cards, and signing them off." },
      { title: "Interviews", href: "/review/interviews", what: "Interview slots and who is booked." },
      { title: "Academy", href: "/review/academy", what: "Training progress and sessions." },
      { title: "Leader pipeline", href: "/admin/leader-pipeline", what: "The steps to become a leader, and Tribe fit." },
      { title: "Leader supply", href: "/admin/leader-supply", what: "Offer a tribe to a leader where members wait." },
      { title: "Growth model", href: "/growth/model", what: "How members are matched." },
    ],
  },
  admin: {
    watches: "Running the platform: people and roles, settings, privacy requests and sign-in.",
    counts: [
      { key: "invitations_pending", label: "invitations not yet accepted", href: "/admin/people" },
      { key: "erasure_open", label: "deletion requests open", href: "/admin/privacy" },
    ],
    items: [
      { title: "Admin", href: "/admin", what: "Everything the office runs." },
      { title: "People and roles", href: "/admin/people", what: "Inviting the team and who holds each role." },
      { title: "Settings", href: "/admin/settings", what: "The church’s details and rules." },
      { title: "Data requests", href: "/admin/privacy", what: "Members who asked for their account to be deleted." },
      { title: "Sign-in", href: "/admin/signin", what: "WhatsApp sign-in: the switch, limits and log." },
      { title: "System", href: "/admin/system", what: "Whether the platform’s parts are running." },
      { title: "Messages", href: "/admin/messages", what: "What was sent and what failed." },
    ],
  },
};

export const DESK_LIST: Desk[] = ROLES.map((role) => ({ role, label: ROLE_LABELS[role], ...DESKS[role] }));

export function deskFor(slug: string): Desk | null {
  return DESK_LIST.find((d) => d.role === slug) ?? null;
}

/** Where the numbers are analysed: nothing here is new, this is the map of where each analysis lives. */
export const ANALYSIS: { title: string; href: string; what: string }[] = [
  { title: "Pulse", href: "/god/activity", what: "What needs a decision this week, and how the church is doing." },
  { title: "Funnels", href: "/god/activity/funnels", what: "Where people stop in the forms, and where members drop off." },
  { title: "Stakeholders", href: "/god/activity/stakeholders", what: "What each group is actually doing, over 30 days." },
  { title: "Quality and integrity", href: "/god/activity/quality", what: "Whether the data can be trusted." },
  { title: "Messages and sign-in", href: "/god/activity/messages", what: "Whether messages and codes are reaching people." },
  { title: "Audit trail", href: "/god/activity/audit", what: "What the church’s people did, line by line." },
  { title: "Leader supply and demand", href: "/admin/leader-supply", what: "Where members wait for a tribe and no leader is ready." },
  { title: "The dashboard", href: "/dashboard", what: "The numbers the data lead and directors read." },
  { title: "Reports", href: "/reports", what: "The monthly reports." },
  { title: "How members are matched", href: "/growth/model", what: "The matching model and what it has learned." },
];

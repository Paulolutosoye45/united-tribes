import { DETAILS_SAMPLES } from "@/lib/messaging/templates-details";
import { INVITATION_SAMPLES } from "@/lib/messaging/templates-invitation";
import { LEADER_WELCOME_SAMPLES } from "@/lib/messaging/templates-leader-welcome";
import { WHATSAPP_SAMPLES } from "@/lib/messaging/templates-whatsapp";
import { REMOVAL_SAMPLES } from "@/lib/messaging/templates-removal";
import { PLACEMENT_SAMPLES } from "@/lib/messaging/templates-placement";
import type { Params } from "@/lib/messaging/types";

/** A believable set of fields, as the database would supply them. Templates read the ones they need. */
const BASE: Params = {
  first_name: "Ada",
  tribe: "Builders Tribe",
  leader: "Ngozi Okafor",
  leader_first: "Ngozi",
  member: "Ada Okafor",
  member_first: "Ada",
  member_name: "Ada Okafor",
  member_whatsapp: "+2348031234567",
  raised_by: "Ngozi",
  week: 3,
  weeks: 12,
  title: "Pray with expectation, not performance",
  passage: "Philippians 4:6-7",
  big_idea: "Prayer is a conversation with a Father who is already listening.",
  confession: "I am heard when I pray, and I pray with expectation.",
  opening_question: "When did you last pray about something and see it answered?",
  will: "pray for five minutes",
  when: "when I wake up",
  highlight: "We prayed for Dayo’s interview.",
  pulse: false,
  step_set: true,
  near_end: false,
  meeting_day: 3,
  meeting_time: "20:00",
  meeting_date: "2027-02-24",
  mode: "online",
  place_note: "",
  meeting_link: "https://meet.example.org/abc-defg",
  starts_on: "2027-02-14",
  first_meeting_on: "2027-02-17",
  first_meeting_by: "2027-03-01",
  group_url: "https://chat.whatsapp.com/abcdef",
  partners: ["Bola", "Chi"],
  season: "Season 1",
  call_by: "2027-02-20",
  joined_on: "2027-02-14",
  members: 9,
  follow_ups: ["Ada"],
  missed: 3,
  by: "Ada",
  note: "She said she is struggling.",
  level: "pastoral",
  due_on: "2027-03-01",
  role: "tribe leader",
  starts_at: "2027-03-09T15:00:00+00:00",
  minutes: 20,
  place: "https://meet.example.org/interview",
  applicant: "Ngozi Okafor",
  referee: "Pastor Femi",
  link: "https://unitedtribes.example/reference/abc",
  person_first: "Ada",
  by_first: "Dayo",
  direction: "in",
  guardian: "Mrs Okafor",
  teen_first: "Ada",
  token: "a".repeat(64),
  what: "approved",
};

const REPORT = { members: 10, present: 8, steps_set: 9, steps_done: 6, follow_ups_open: 2 };

const T = (n: number) => `${n}`.padStart(2, "0").repeat(32);
const CHURCH = { name: "The Covenant Nation", address: "Km 10, Idiroko Road, Ota" };
const LINKS = { go: T(11), stop: T(12), prefs: T(13), help_finish: T(14), not_season: T(15) };

const OVERRIDES: Record<string, Params> = {
  reminder_email: {
    kind: "reminder",
    copy: {
      journey: "member_form", step: 1, tone: "warm", subject: "You’re part-way to your tribe, {first_name}",
      paragraphs: ["You started telling us about your season, and your answers are saved just as you left them.", "About five more minutes and you’ll see three tribes that fit you."],
      button_label: "Carry on where I stopped", actions: [],
    },
    data: { first_name: "Ada", step: "story", erase_date: "9 March 2027" },
    links: LINKS,
    church: CHURCH,
  },
  office_message: {
    kind: "announcement",
    copy: { subject: "Your tribe is waiting, {first_name}", paragraphs: ["We saved your answers.", "Season starts {season_starts}."], button_label: "Carry on", actions: [], tone: "office", step: 0 },
    data: { first_name: "Ada", tribe: "your tribe", season_starts: "14 February 2027", my_page: "/home" },
    links: LINKS,
    church: CHURCH,
  },
  broadcast_waiting: { count: 412, title: "Welcome back" },
  reminder_paused: { journey: "Started the form, not finished", why: "More people than usual asked us to stop." },
  journey_ask: { kind: "in_the_way", who: "Ada Okafor", journey: "In a tribe, nothing done yet" },
  weekly_report: { missed: ["Ada", "Bola"], messages_sent: ["Ada"], report: REPORT },
  coach_digest: {
    tribes: [
      { tribe: "Builders Tribe", leader: "Ngozi", report: REPORT },
      { tribe: "Pillars", leader: "Tunde", report: { ...REPORT, present: 3 } },
    ],
  },
  coach_missed_three: { missed: 3 },
  referee_request: { kind: "email", secret: "r".repeat(43), days: 30, referee: "Pastor Femi", applicant: "Ngozi Okafor", applicant_first: "Ngozi" },
  referee_reverify: { kind: "email", secret: "r".repeat(43), days: 30, referee: "Pastor Femi", applicant: "Ngozi Okafor", applicant_first: "Ngozi" },
  referee_code: { code: "482913", minutes: 10, referee: "Pastor Femi", applicant: "Ngozi Okafor" },
  ...PLACEMENT_SAMPLES,
  ...INVITATION_SAMPLES,
  ...LEADER_WELCOME_SAMPLES,
  ...DETAILS_SAMPLES,
  ...WHATSAPP_SAMPLES,
  ...REMOVAL_SAMPLES,
};

export function sampleParams(template: string): Params {
  return { ...BASE, ...(OVERRIDES[template] ?? {}) };
}

import type { GroupKind, PersonKind } from "./mode-view";

// The words a leader starts from when they send WhatsApp themselves. They are suggestions the leader reads and changes before sending; they carry no
// private detail about anyone, only what the whole tribe already knows. "[first]" is replaced by each member's first name.

export type HandWeek = { week: number | null; title: string; passage: string; bigIdea: string; tribe: string; meetingDay: string; meetingTime: string; leaderFirst: string; site: string };

const day = (w: HandWeek) => (w.meetingDay ? `${w.meetingDay}s` : "this week");
const at = (w: HandWeek) => (w.meetingTime ? ` at ${w.meetingTime}` : "");

export function groupText(kind: GroupKind, w: HandWeek): string {
  switch (kind) {
    case "week_start":
      return [
        `${w.week ? `Week ${w.week} in ${w.tribe}` : `This week in ${w.tribe}`}${w.title ? `: ${w.title}` : ""}.`,
        w.passage ? `Read ${w.passage} on five days.` : "",
        w.bigIdea,
        `Open your week and set your step: ${w.site}/rhythm`,
      ]
        .filter(Boolean)
        .join(" ");
    case "meeting_reminder":
      return `${w.tribe} meets ${day(w)}${at(w)}.${w.title ? ` This week: ${w.title}.` : ""} See you there.`;
    case "meeting_recap":
      return `Thank you for showing up this week.${w.title ? ` This week was ${w.title}.` : ""} Open your week to set your step: ${w.site}/rhythm`;
    default:
      return "";
  }
}

export function personText(kind: PersonKind, w: HandWeek): string {
  switch (kind) {
    case "welcome":
      return `Hi [first], welcome to ${w.tribe}! I'm ${w.leaderFirst}, your leader. We meet ${day(w)}${at(w)}. Glad you're here.`;
    case "missed_two":
      return `Hi [first], we've missed you these past two weeks. How are you? No pressure at all, I'd just love to hear from you.`;
    case "step":
      return `Hi [first], how is your step going this week? I'm praying for you.`;
    case "thanks":
      return `Hi [first], thank you for showing up. It meant a lot to the tribe.`;
    default:
      return "Hi [first], ";
  }
}

export const withFirst = (text: string, first: string) => text.replace(/\[first\]/g, first);

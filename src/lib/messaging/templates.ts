import { clock, dayName, flat, list, meetsText, names, num, shortDay, smsLine, str } from "./format";
import { OUTREACH_TEMPLATES } from "@/lib/outreach/templates";
import { NOTICE_TEMPLATES } from "./templates-notices";
import { INVITATION_TEMPLATES } from "./templates-invitation";
import { LEADER_WELCOME_TEMPLATES } from "./templates-leader-welcome";
import { DETAILS_TEMPLATES } from "./templates-details";
import { WHATSAPP_TEMPLATES } from "./templates-whatsapp";
import { REACH_TEMPLATES } from "./templates-reach";
import { REACH_SERIES_TEMPLATES } from "./templates-reach-series";
import { LEADER_CARD_TEMPLATES } from "./templates-leader-cards";
import { REMOVAL_TEMPLATES } from "./templates-removal";
import { PLACEMENT_TEMPLATES } from "./templates-placement";
import { PLACED_SEQ_TEMPLATES } from "./templates-placed-seq";
import { salutation } from "@/lib/leaders/status";
import { digestSummary } from "./summary";
import type { Context, Params, TemplateDef } from "./types";

/**
 * The wording of every message the platform sends. The database decides who gets
 * what and when (supabase/migrations/…messaging_*.sql) and puts everything the
 * wording needs in `params`; this file turns that into an email, a text message
 * and a WhatsApp template. Change a sentence here and the next message uses it.
 *
 * WhatsApp is different: Meta has to approve the exact wording of each template
 * before it can be used. Run `npm run templates` to print them (or submit them),
 * and send a template again for approval whenever its `body` changes here.
 *
 * Rules for the wording: short, warm, plain, in the voice of a friend in the
 * tribe, never of a system. One idea and one link per message.
 */

const first = (p: Params, key: string, fallback = "your leader") => str(p[key]) || fallback;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

const welcome: TemplateDef = {
  key: "welcome",
  audience: "member",
  title: "Welcome to your tribe",
  email: (p, c) => ({
    subject: `You’re in: welcome to ${str(p.tribe)}`,
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `You’ve joined ${str(p.tribe)}, led by ${first(p, "leader_first")}. It meets ${meetsText(p)}.`,
      `${first(p, "leader_first")} will call or message you within three days to say hello.` +
        (str(p.first_meeting_on) ? ` Your first meeting is on ${shortDay(str(p.first_meeting_on))}.` : ` Your first meeting should be by ${shortDay(str(p.first_meeting_by))}.`),
      ...(str(p.group_url) ? [`Your tribe’s WhatsApp group: ${str(p.group_url)}`] : []),
      `The season begins on ${shortDay(str(p.starts_on))}.`,
    ],
    cta: { label: "See my tribe", url: c.link("/tribe") },
  }),
  sms: (p, c) => smsLine(`Welcome to ${str(p.tribe)}. It meets ${meetsText(p)}. ${first(p, "leader_first")} will be in touch within 3 days.`, c.link("/tribe")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, welcome to {{2}}. It meets {{3}}. {{4}} will be in touch within three days. Your tribe page: {{5}}",
    example: ["Ada", "Builders Tribe", "Wednesdays at 8:00 pm, online", "Ngozi", "https://unitedtribes.example/tribe"],
    vars: [flat(c.first), flat(p.tribe), flat(meetsText(p)), flat(first(p, "leader_first")), flat(c.link("/tribe"))],
  }),
};

const seasonStartsSoon: TemplateDef = {
  key: "season_starts_soon",
  audience: "member",
  title: "The season starts in two days",
  email: (p, c) => ({
    subject: `Your season starts on ${shortDay(str(p.starts_on))}`,
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `${str(p.tribe)} begins on ${shortDay(str(p.starts_on))}. It meets ${meetsText(p)}.`,
      ...(str(p.meeting_link) ? [`Meeting link: ${str(p.meeting_link)}`] : []),
      ...(str(p.first_meeting_on) ? [`Your first meeting is on ${shortDay(str(p.first_meeting_on))}.`] : []),
      "Come as you are. Bring one thing you hope will be different by the end of twelve weeks.",
    ],
    cta: { label: "See my tribe", url: c.link("/tribe") },
  }),
  sms: (p, c) => smsLine(`${str(p.tribe)} starts ${shortDay(str(p.starts_on))}. It meets ${meetsText(p)}.`, c.link("/tribe")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, your season with {{2}} starts on {{3}}. The tribe meets {{4}}. Details: {{5}}",
    example: ["Ada", "Builders Tribe", "Sun 14 Feb", "Wednesdays at 8:00 pm, online", "https://unitedtribes.example/tribe"],
    vars: [flat(c.first), flat(p.tribe), flat(shortDay(str(p.starts_on))), flat(meetsText(p)), flat(c.link("/tribe"))],
  }),
};

const weekStart: TemplateDef = {
  key: "week_start",
  audience: "member",
  title: "Monday: the week’s passage, confession and step",
  email: (p, c) => ({
    subject: `Week ${num(p.week)}: ${str(p.title)}`,
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `This week in ${str(p.tribe)}: ${str(p.title)}. Read ${str(p.passage)} on five days.`,
      str(p.big_idea),
      ...(str(p.confession) ? [`Say it aloud each day: “${str(p.confession)}”`] : []),
      str(p.will) ? `Your step: when ${str(p.when).replace(/^when\s+/i, "")}, I will ${str(p.will)}.` : "You haven’t set your step for the week yet. It takes a minute, and makes the week.",
      ...(p.pulse === true ? ["This is a check-in week: after the meeting, take two minutes to tell us how it’s going."] : []),
    ],
    cta: { label: str(p.will) ? "Open my week" : "Set my step", url: c.link("/rhythm") },
  }),
  sms: (p, c) => smsLine(`Week ${num(p.week)} in ${str(p.tribe)}: ${str(p.title)}. Read ${str(p.passage)}.${str(p.will) ? ` Your step: ${str(p.will)}.` : " Set your step for the week."}`, c.link("/rhythm")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, week {{2}} of your tribe: {{3}}. Read {{4}} on five days. {{5}} Open your week: {{6}}",
    example: ["Ada", "3", "Pray with expectation, not performance", "Philippians 4:6-7", "Your step: pray for five minutes when I wake up.", "https://unitedtribes.example/rhythm"],
    vars: [
      flat(c.first), flat(num(p.week)), flat(p.title), flat(p.passage),
      flat(str(p.will) ? `Your step: ${str(p.will)}.` : "Set your step for the week."), flat(c.link("/rhythm")),
    ],
  }),
};

const triadPrompt: TemplateDef = {
  key: "triad_prompt",
  audience: "member",
  title: "Tuesday: check in with your triad",
  email: (p, c) => ({
    subject: "Check in with your triad",
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `This week your triad is you, ${names(list(p.partners))}.`,
      "Send each of them one message today: how is the step going, and what can you pray about? It takes two minutes and it is often what keeps someone going.",
    ],
    cta: { label: "Open my week", url: c.link("/rhythm") },
  }),
  sms: (p, c) => smsLine(`Your triad this week: ${names(list(p.partners))}. Send each one a message today: how is the step going?`, c.link("/rhythm")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, your triad this week is {{2}}. Send each one a message today: how is the step going and what can you pray about? {{3}}",
    example: ["Ada", "Bola and Chi", "https://unitedtribes.example/rhythm"],
    vars: [flat(c.first), flat(names(list(p.partners))), flat(c.link("/rhythm"))],
  }),
};

const meetingReminder: TemplateDef = {
  key: "meeting_reminder",
  audience: "member",
  title: "Two hours before the meeting",
  email: (p, c) => ({
    subject: `Tonight at ${clock(str(p.meeting_time))}: ${str(p.tribe)}`,
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `${str(p.tribe)} meets at ${clock(str(p.meeting_time))}, ${str(p.mode) === "online" ? "online" : `in person${str(p.place_note) ? ` (${str(p.place_note)})` : ""}`}.`,
      ...(str(p.mode) === "online" && str(p.meeting_link) ? [`Join here: ${str(p.meeting_link)}`] : []),
      `This week: ${str(p.title)}.`,
    ],
    cta: str(p.meeting_link) ? { label: "Join the meeting", url: str(p.meeting_link) } : { label: "Open my week", url: c.link("/rhythm") },
  }),
  sms: (p, c) => smsLine(`${str(p.tribe)} meets at ${clock(str(p.meeting_time))}. ${str(p.meeting_link) ? "Join: " : ""}`.trim(), str(p.meeting_link) || c.link("/rhythm")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, {{2}} meets at {{3}}, {{4}}. This week: {{5}}. {{6}}",
    example: ["Ada", "Builders Tribe", "8:00 pm", "online", "Hear Him every day", "Join: https://meet.example.org/abc"],
    vars: [
      flat(c.first), flat(p.tribe), flat(clock(str(p.meeting_time))),
      flat(str(p.mode) === "online" ? "online" : `in person${str(p.place_note) ? `, ${str(p.place_note)}` : ""}`),
      flat(p.title), flat(str(p.meeting_link) ? `Join: ${str(p.meeting_link)}` : `Details: ${c.link("/rhythm")}`),
    ],
  }),
};

const meetingRecap: TemplateDef = {
  key: "meeting_recap",
  audience: "member",
  title: "The morning after: recap and your step",
  email: (p, c) => ({
    subject: `Last night in ${str(p.tribe)}`,
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `Thank you for showing up. This week was ${str(p.title)}.`,
      ...(str(p.highlight) ? [`A highlight from your leader: ${str(p.highlight)}`] : []),
      str(p.will) ? `Your step: when ${str(p.when).replace(/^when\s+/i, "")}, I will ${str(p.will)}.` : "You haven’t set your step for this week. Choose one small thing you can do even on a bad day.",
    ],
    cta: { label: str(p.will) ? "Open my week" : "Set my step", url: c.link("/rhythm") },
  }),
  sms: (p, c) => smsLine(`Thanks for last night. ${str(p.will) ? `Your step: ${str(p.will)}.` : "Set your step for the week."}`, c.link("/rhythm")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, thank you for showing up at {{2}}. This week was {{3}}. {{4}} {{5}}",
    example: ["Ada", "Builders Tribe", "Hear Him every day", "Your step: pray for five minutes when I wake up.", "https://unitedtribes.example/rhythm"],
    vars: [flat(c.first), flat(p.tribe), flat(p.title), flat(str(p.will) ? `Your step: ${str(p.will)}.` : "Set your step for the week."), flat(c.link("/rhythm"))],
  }),
};

const fridayCheckin: TemplateDef = {
  key: "friday_checkin",
  audience: "member",
  title: "Friday: one-tap step check-in and testimony prompt",
  email: (p, c) => ({
    subject: "How did your step go?",
    greeting: `Hi ${c.first},`,
    paragraphs: [
      p.step_set === true ? `Your step this week: when ${str(p.when).replace(/^when\s+/i, "")}, I will ${str(p.will)}.` : "You didn’t set a step this week. You can still tell us how the week went.",
      "One tap is enough: did you do it?",
      ...(p.near_end === true ? ["Has God done something this season? Share a short testimony when you open your week."] : ["If God did something this week, you can share a short testimony when you open your week."]),
    ],
    options: (["done", "partly", "not_yet"] as const)
      .map((o) => ({ label: o === "done" ? "Done" : o === "partly" ? "Partly" : "Not yet", url: c.reply(o) ?? "" }))
      .filter((o) => o.url),
    cta: { label: "Open my week", url: c.link("/rhythm") },
  }),
  sms: (p, c) => smsLine(`How did your step go this week${str(p.will) ? ` (${str(p.will)})` : ""}? Tap to answer:`, c.reply("done")?.replace(/\?o=done$/, "") ?? c.link("/rhythm")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, how did your step go this week? {{2}} Tap an answer below. If God did something this week, share it in your week page: {{3}}",
    example: ["Ada", "Your step: pray for five minutes when I wake up.", "https://unitedtribes.example/rhythm"],
    vars: [flat(c.first), flat(str(p.will) ? `Your step: ${str(p.will)}.` : "You can still tell us how the week went."), flat(c.link("/rhythm"))],
    quickReplies: ["Done", "Partly", "Not yet"],
  }),
};

const memberMissedTwo: TemplateDef = {
  key: "member_missed_two",
  audience: "member",
  title: "We missed you",
  email: (p, c) => ({
    subject: "We missed you",
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `We’ve missed you at ${str(p.tribe)} these last two meetings. Nothing is wrong with you being away, and there is a seat for you when you’re ready.`,
      `${first(p, "leader_first")} would love to hear from you. Even a one-line reply helps.`,
    ],
    cta: { label: "Open my tribe", url: c.link("/tribe") },
  }),
  sms: (p) => smsLine(`We’ve missed you at ${str(p.tribe)}. ${first(p, "leader_first")} would love to hear from you. There is a seat for you.`),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, we have missed you at {{2}}. There is a seat for you whenever you are ready, and {{3}} would love to hear from you.",
    example: ["Ada", "Builders Tribe", "Ngozi"],
    vars: [flat(c.first), flat(p.tribe), flat(first(p, "leader_first"))],
  }),
};

const seasonComplete: TemplateDef = {
  key: "season_complete",
  audience: "member",
  title: "The season is complete",
  email: (p, c) => ({
    subject: `${str(p.season, "The season")} is complete`,
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `Twelve weeks with ${str(p.tribe)} are done. Thank you for showing up, week after week.`,
      "Take a look at how far you came, and share a testimony if you haven’t yet. It encourages the next person to begin.",
    ],
    cta: { label: "See my season", url: c.link("/tribe") },
  }),
  sms: (p, c) => smsLine(`${str(p.tribe)} has completed its season. Thank you. See how far you came:`, c.link("/tribe")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, your season with {{2}} is complete. Thank you for showing up week after week. See how far you came: {{3}}",
    example: ["Ada", "Builders Tribe", "https://unitedtribes.example/tribe"],
    vars: [flat(c.first), flat(p.tribe), flat(c.link("/tribe"))],
  }),
};

// ---------------------------------------------------------------------------
// Leaders
// ---------------------------------------------------------------------------

const newMember: TemplateDef = {
  key: "new_member",
  audience: "leader",
  title: "Someone joined your tribe: call within 72 hours",
  email: (p, c) => ({
    subject: `${str(p.member_first)} joined ${str(p.tribe)}`,
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `${str(p.member_name, str(p.member_first))} has chosen your tribe. A short call within three days (by ${shortDay(str(p.call_by))}) makes the difference between someone who comes and someone who stays.`,
      ...(str(p.member_whatsapp) ? [`They shared their WhatsApp number: ${str(p.member_whatsapp)}`] : ["They haven’t shared a number. Reach them through your roster."]),
      "Mark them as called once you have spoken.",
    ],
    cta: { label: "Open my tribe", url: c.link("/lead/tribe") },
  }),
  sms: (p, c) => smsLine(`${str(p.member_first)} joined ${str(p.tribe)}. Please call them by ${shortDay(str(p.call_by))}.`, c.link("/lead/tribe")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, {{2}} has joined {{3}}. Please call them by {{4}}. {{5}} Mark them as called here: {{6}}",
    example: ["Ngozi", "Ada", "Builders Tribe", "Fri 19 Feb", "Their number: +2348031234567.", "https://unitedtribes.example/lead/tribe"],
    vars: [flat(c.first), flat(p.member_first), flat(p.tribe), flat(shortDay(str(p.call_by))), flat(str(p.member_whatsapp) ? `Their number: ${str(p.member_whatsapp)}.` : "Find them on your roster."), flat(c.link("/lead/tribe"))],
  }),
};

const welcomeCallOverdue: TemplateDef = {
  key: "welcome_call_overdue",
  audience: "leader",
  title: "A new member has not been called yet",
  email: (p, c) => ({
    subject: `Have you reached ${str(p.member_first)} yet?`,
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `${str(p.member_first)} joined ${str(p.tribe)} on ${shortDay(str(p.joined_on))} and hasn’t been marked as called. A friendly call or voice note today matters.`,
      ...(str(p.member_whatsapp) ? [`Their WhatsApp number: ${str(p.member_whatsapp)}`] : []),
    ],
    cta: { label: "Open my tribe", url: c.link("/lead/tribe") },
  }),
  sms: (p, c) => smsLine(`Have you reached ${str(p.member_first)} yet? They joined ${str(p.tribe)} on ${shortDay(str(p.joined_on))}.`, c.link("/lead/tribe")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, {{2}} joined {{3}} on {{4}} and has not been marked as called yet. A friendly call today matters. Mark them here: {{5}}",
    example: ["Ngozi", "Ada", "Builders Tribe", "Mon 15 Feb", "https://unitedtribes.example/lead/tribe"],
    vars: [flat(c.first), flat(p.member_first), flat(p.tribe), flat(shortDay(str(p.joined_on))), flat(c.link("/lead/tribe"))],
  }),
};

const leaderPrep: TemplateDef = {
  key: "leader_prep",
  audience: "leader",
  title: "Monday: your prep pack",
  email: (p, c) => ({
    subject: `Prep for week ${num(p.week)}: ${str(p.title)}`,
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `Your next meeting (${shortDay(str(p.meeting_date))}) is week ${num(p.week)} of ${num(p.weeks)}: ${str(p.title)}, from ${str(p.passage)}.`,
      str(p.big_idea),
      `Start with this question: ${str(p.opening_question)}`,
      list(p.follow_ups).length > 0 ? `Follow up with: ${names(list(p.follow_ups))}.` : `You have ${plural(num(p.members), "member")}, and no open follow-ups.`,
    ],
    cta: { label: "Open the full guide", url: c.link("/lead/week") },
  }),
  sms: (p, c) => smsLine(`Prep for ${str(p.tribe)}, week ${num(p.week)}: ${str(p.title)}.`, c.link("/lead/week")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, your prep for {{2}} is ready. Week {{3}}: {{4}}, from {{5}}. Start with: {{6}} Full guide: {{7}}",
    example: ["Ngozi", "Builders Tribe", "3", "Pray with expectation, not performance", "Philippians 4:6-7", "What is one thing you have been carrying alone?", "https://unitedtribes.example/lead/week"],
    vars: [flat(c.first), flat(p.tribe), flat(num(p.week)), flat(p.title), flat(p.passage), flat(p.opening_question), flat(c.link("/lead/week"))],
  }),
};

const leaderMeetingReminder: TemplateDef = {
  key: "leader_meeting_reminder",
  audience: "leader",
  title: "Two hours before: your reminder with the guide",
  email: (p, c) => ({
    subject: `In two hours: ${str(p.tribe)}`,
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `${str(p.tribe)} meets at ${clock(str(p.meeting_time))}. Week ${num(p.week)}: ${str(p.title)}.`,
      `Open with: ${str(p.opening_question)}`,
    ],
    cta: { label: "Open the guide", url: c.link("/lead/week") },
  }),
  sms: (p, c) => smsLine(`${str(p.tribe)} meets at ${clock(str(p.meeting_time))}. Week ${num(p.week)}: ${str(p.title)}.`, c.link("/lead/week")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, {{2}} meets at {{3}}. Week {{4}}: {{5}}. Your guide: {{6}}",
    example: ["Ngozi", "Builders Tribe", "8:00 pm", "3", "Pray with expectation, not performance", "https://unitedtribes.example/lead/week"],
    vars: [flat(c.first), flat(p.tribe), flat(clock(str(p.meeting_time))), flat(num(p.week)), flat(p.title), flat(c.link("/lead/week"))],
  }),
};

const leaderLogLink: TemplateDef = {
  key: "leader_log_link",
  audience: "leader",
  title: "After the meeting: the two-minute log",
  email: (p, c) => ({
    subject: `Log tonight’s meeting (two minutes)`,
    greeting: `Hi ${c.first},`,
    paragraphs: [`How did ${str(p.tribe)} go? Tap who came, add a highlight, and you’re done. It feeds your weekly report.`],
    cta: { label: "Log the meeting", url: c.link("/lead/week") },
  }),
  sms: (p, c) => smsLine(`Log tonight’s ${str(p.tribe)} meeting (two minutes):`, c.link("/lead/week")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, how did {{2}} go tonight? Log it in two minutes: {{3}}",
    example: ["Ngozi", "Builders Tribe", "https://unitedtribes.example/lead/week"],
    vars: [flat(c.first), flat(p.tribe), flat(c.link("/lead/week"))],
  }),
};

const leaderLogReminder: TemplateDef = {
  key: "leader_log_reminder",
  audience: "leader",
  title: "The meeting has not been logged (24 hours)",
  email: (p, c) => ({
    subject: `Your week ${num(p.week)} log is waiting`,
    greeting: `Hi ${c.first},`,
    paragraphs: [`We haven’t had your log for week ${num(p.week)} of ${str(p.tribe)}. It takes two minutes, and it lets your coach see how the tribe is doing.`],
    cta: { label: "Log the meeting", url: c.link("/lead/week") },
  }),
  sms: (p, c) => smsLine(`Your week ${num(p.week)} log for ${str(p.tribe)} is still waiting. Two minutes:`, c.link("/lead/week")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, your week {{2}} log for {{3}} is still waiting. It takes two minutes: {{4}}",
    example: ["Ngozi", "3", "Builders Tribe", "https://unitedtribes.example/lead/week"],
    vars: [flat(c.first), flat(num(p.week)), flat(p.tribe), flat(c.link("/lead/week"))],
  }),
};

const weeklyReport: TemplateDef = {
  key: "weekly_report",
  audience: "leader",
  title: "Saturday: the weekly tribe report",
  email: (p, c) => {
    const r = (p.report ?? {}) as Record<string, unknown>;
    const missed = list(p.missed);
    return {
      subject: `Week ${num(p.week)} report: ${str(p.tribe)}`,
      greeting: `Hi ${c.first},`,
      paragraphs: [
        r.held === false
          ? "The tribe did not meet this week."
          : r.logged === true
            ? `${num(r.present)} of ${num(r.members)} came this week.`
            : "This week’s meeting hasn’t been logged yet.",
        `${num(r.steps_done)} of ${num(r.steps_set)} steps were done${num(r.steps_partly) > 0 ? `, ${num(r.steps_partly)} partly` : ""}.`,
        missed.length > 0
          ? `Missed: ${names(missed)}.${list(p.messages_sent).length > 0 ? " We’ve already sent you a suggested message to forward." : ""}`
          : "Nobody missed this week.",
        `Open follow-ups: ${num(r.follow_ups_open)}.${num(r.testimonies) > 0 ? ` New testimonies: ${num(r.testimonies)}.` : ""}`,
        ...(r.belonging_average != null ? [`Belonging this check-in: ${num(r.belonging_average)} out of 5.`] : []),
      ],
      cta: { label: "Open the full report", url: c.link("/lead/progress") },
    };
  },
  sms: (p, c) => {
    const r = (p.report ?? {}) as Record<string, unknown>;
    return smsLine(`${str(p.tribe)} week ${num(p.week)}: ${num(r.present)}/${num(r.members)} came, ${num(r.steps_done)}/${num(r.steps_set)} steps done, ${num(r.follow_ups_open)} follow-ups open.`, c.link("/lead/progress"));
  },
  whatsapp: (p, c) => {
    const r = (p.report ?? {}) as Record<string, unknown>;
    return {
      body: "Hi {{1}}, your {{2}} report for week {{3}}: {{4}} of {{5}} came, {{6}} of {{7}} steps done, {{8}} follow-ups open. Full report: {{9}}",
      example: ["Ngozi", "Builders Tribe", "3", "9", "11", "7", "10", "1", "https://unitedtribes.example/lead/progress"],
      vars: [flat(c.first), flat(p.tribe), flat(num(p.week)), flat(num(r.present)), flat(num(r.members)), flat(num(r.steps_done)), flat(num(r.steps_set)), flat(num(r.follow_ups_open)), flat(c.link("/lead/progress"))],
    };
  },
};

const leaderMissedOne: TemplateDef = {
  key: "leader_missed_one",
  audience: "leader",
  title: "A member missed a meeting: a warm message to forward",
  email: (p, c) => ({
    subject: `${str(p.member_first)} wasn’t at ${str(p.tribe)}`,
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `${str(p.member_first)} missed week ${num(p.week)}. One miss is nothing to worry about; a warm word usually does it. Here is a message you can send:`,
    ],
    quote: suggestedMissedMessage(p),
    cta: { label: "Open my tribe", url: c.link("/lead/tribe") },
  }),
  sms: (p) => smsLine(`${str(p.member_first)} missed ${str(p.tribe)} this week. Send them a warm word: "${suggestedMissedMessage(p)}"`),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, {{2}} missed week {{3}} of {{4}}. A warm word usually does it. You could send: {{5}} {{6}}",
    example: ["Ngozi", "Ada", "3", "Builders Tribe", "Hi Ada, we missed you tonight. Hope all is well.", "Their number: +2348031234567."],
    vars: [flat(c.first), flat(p.member_first), flat(num(p.week)), flat(p.tribe), flat(suggestedMissedMessage(p)), flat(str(p.member_whatsapp) ? `Their number: ${str(p.member_whatsapp)}.` : "Find them on your roster.")],
  }),
};

/** The message a leader can forward after one missed meeting. */
export function suggestedMissedMessage(p: Params): string {
  return `Hi ${str(p.member_first, "friend")}, we missed you at tribe this week. Hope all is well. No pressure, just wanted you to know you were on our minds. ${first(p, "leader_first", "Your leader")}`;
}

const leaderMissedTwo: TemplateDef = {
  key: "leader_missed_two",
  audience: "leader",
  title: "Two meetings missed in a row: call them",
  email: (p, c) => ({
    subject: `Please call ${str(p.member_first)}`,
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `${str(p.member_first)} has now missed two meetings in a row. A call, not a text, is what is needed now. Ask how they are before anything else.`,
      ...(str(p.member_whatsapp) ? [`Their WhatsApp number: ${str(p.member_whatsapp)}`] : []),
      "We’ve sent them a gentle “we missed you” note. After you call, record how it went so the care team knows.",
    ],
    cta: { label: "Record the call", url: c.link("/lead/week") },
  }),
  sms: (p, c) => smsLine(`${str(p.member_first)} has missed 2 meetings in a row. Please call them.`, c.link("/lead/week")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, {{2}} has missed two meetings in a row. Please call them today, and ask how they are first. Record the call here: {{3}}",
    example: ["Ngozi", "Ada", "https://unitedtribes.example/lead/week"],
    vars: [flat(c.first), flat(p.member_first), flat(c.link("/lead/week"))],
  }),
};

const birthdayTomorrow: TemplateDef = {
  key: "birthday_tomorrow",
  audience: "leader",
  title: "A birthday tomorrow",
  email: (p, c) => ({
    subject: `${str(p.member_first)}’s birthday is tomorrow`,
    greeting: `Hi ${c.first},`,
    paragraphs: [`It’s ${str(p.member_first)}’s birthday tomorrow. A personal message from you will mean a lot.`],
    cta: { label: "Open my tribe", url: c.link("/lead/tribe") },
  }),
  sms: (p) => smsLine(`${str(p.member_first)}’s birthday is tomorrow. A message from you will mean a lot.`),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, it is {{2}}'s birthday tomorrow. A personal message from you will mean a lot.",
    example: ["Ngozi", "Ada"],
    vars: [flat(c.first), flat(p.member_first)],
  }),
};

const birthdayToday: TemplateDef = {
  key: "birthday_today",
  audience: "leader",
  title: "A birthday today: prompt the group",
  email: (p, c) => ({
    subject: `Today is ${str(p.member_first)}’s birthday`,
    greeting: `Hi ${c.first},`,
    paragraphs: [`Today is ${str(p.member_first)}’s birthday. Post this in your tribe’s group so everyone can celebrate:`],
    quote: `Happy birthday ${str(p.member_first)}! 🎉 We thank God for your life and we are glad you are in this tribe. Let’s all send a word of blessing today.`,
    cta: str(p.group_url) ? { label: "Open the group", url: str(p.group_url) } : undefined,
  }),
  sms: (p) => smsLine(`Today is ${str(p.member_first)}’s birthday. Post a happy birthday in your group.`),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, today is {{2}}'s birthday. Post a happy birthday in your tribe's group so everyone can celebrate. {{3}}",
    example: ["Ngozi", "Ada", "Your group: https://chat.whatsapp.com/abcdef12345"],
    vars: [flat(c.first), flat(p.member_first), flat(str(p.group_url) ? `Your group: ${str(p.group_url)}` : "")],
  }),
};

const testimonyWaiting: TemplateDef = {
  key: "testimony_waiting",
  audience: "leader",
  title: "A testimony is waiting for you",
  email: (p, c) => ({
    subject: "A testimony is waiting for your approval",
    greeting: `Hi ${c.first},`,
    paragraphs: [`${str(p.by)} shared a testimony in ${str(p.tribe)}. Please read it and approve it for the tribe.`],
    cta: { label: "Read it", url: c.link("/lead/week") },
  }),
  sms: (p, c) => smsLine(`A testimony from ${str(p.by)} is waiting for your approval in ${str(p.tribe)}.`, c.link("/lead/week")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, {{2}} shared a testimony in {{3}}. Please read it and approve it for the tribe: {{4}}",
    example: ["Ngozi", "Ada", "Builders Tribe", "https://unitedtribes.example/lead/week"],
    vars: [flat(c.first), flat(p.by), flat(p.tribe), flat(c.link("/lead/week"))],
  }),
};

// ---------------------------------------------------------------------------
// Coaches
// ---------------------------------------------------------------------------

const coachDigest: TemplateDef = {
  key: "coach_digest",
  audience: "coach",
  title: "Monday: your tribes’ digest",
  email: (p, c) => {
    const tribes = Array.isArray(p.tribes) ? (p.tribes as { tribe?: string; leader?: string; report?: Record<string, unknown> }[]) : [];
    const label: Record<string, string> = { on_track: "on track", watch: "watch", needs_attention: "needs attention", no_log: "not logged", upcoming: "upcoming" };
    return {
      subject: `Your tribes, week ${num(p.week)}`,
      greeting: `Hi ${c.first},`,
      paragraphs: [
        ...(str(p.summary) || digestSummary(p) ? [str(p.summary) || digestSummary(p)] : []),
        `Week ${num(p.week)} of ${num(p.weeks)} for your ${plural(tribes.length, "tribe")}:`,
        ...tribes.map((x) => {
          const r = x.report ?? {};
          const status = label[str(r.status)] ?? str(r.status);
          return `• ${str(x.tribe)} (${str(x.leader)}): ${status}${r.logged === true && r.held === true ? `, ${num(r.present)}/${num(r.members)} came` : ""}${num(r.follow_ups_open) > 0 ? `, ${num(r.follow_ups_open)} follow-up${num(r.follow_ups_open) === 1 ? "" : "s"} open` : ""}`;
        }),
      ],
      cta: { label: "Open the weekly report", url: c.link("/review/rhythm") },
    };
  },
  sms: (p, c) => smsLine(`Your ${plural(Array.isArray(p.tribes) ? p.tribes.length : 0, "tribe")}, week ${num(p.week)}: see the digest.`, c.link("/review/rhythm")),
  whatsapp: (p, c) => {
    const tribes = Array.isArray(p.tribes) ? (p.tribes as { report?: Record<string, unknown> }[]) : [];
    const attention = tribes.filter((x) => ["needs_attention", "no_log"].includes(str(x.report?.status))).length;
    return {
      body: "Hi {{1}}, your digest for week {{2}}: {{3}} tribes, {{4}} need attention. Open the report: {{5}}",
      example: ["Sade", "3", "5", "1", "https://unitedtribes.example/review/rhythm"],
      vars: [flat(c.first), flat(num(p.week)), flat(tribes.length), flat(attention), flat(c.link("/review/rhythm"))],
    };
  },
};

const coachLogMissing: TemplateDef = {
  key: "coach_log_missing",
  audience: "coach",
  title: "A leader has not logged (48 hours)",
  email: (p, c) => ({
    subject: `${str(p.tribe)} hasn’t logged week ${num(p.week)}`,
    greeting: `Hi ${c.first},`,
    paragraphs: [`${str(p.leader)} hasn’t logged week ${num(p.week)} for ${str(p.tribe)} after two days, even after a reminder. A quick check on how they are would help.`],
    cta: { label: "Open the weekly report", url: c.link("/review/rhythm") },
  }),
  sms: (p, c) => smsLine(`${str(p.leader)} hasn’t logged week ${num(p.week)} for ${str(p.tribe)} yet. Please check in with them.`, c.link("/review/rhythm")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, {{2}} has not logged week {{3}} for {{4}} after two days. Please check in with them. Report: {{5}}",
    example: ["Sade", "Ngozi", "3", "Builders Tribe", "https://unitedtribes.example/review/rhythm"],
    vars: [flat(c.first), flat(p.leader), flat(num(p.week)), flat(p.tribe), flat(c.link("/review/rhythm"))],
  }),
};

const coachMissedThree: TemplateDef = {
  key: "coach_missed_three",
  audience: "coach",
  title: "A member has missed three meetings",
  email: (p, c) => ({
    subject: `${str(p.member_name, str(p.member_first))} has missed ${num(p.missed)} meetings`,
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `${str(p.member_name, str(p.member_first))} in ${str(p.tribe)} (leader: ${str(p.leader)}) has now missed ${num(p.missed)} meetings in a row.`,
      "Please speak with the leader about how to reach them, and take it to the care lead if they cannot be reached.",
    ],
    cta: { label: "Open the weekly report", url: c.link("/review/rhythm") },
  }),
  sms: (p, c) => smsLine(`${str(p.member_first)} in ${str(p.tribe)} has missed ${num(p.missed)} meetings. Please follow up with the leader.`, c.link("/review/rhythm")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, {{2}} in {{3}} has missed {{4}} meetings in a row. Please follow up with the leader, {{5}}. Report: {{6}}",
    example: ["Sade", "Ada Okafor", "Builders Tribe", "3", "Ngozi", "https://unitedtribes.example/review/rhythm"],
    vars: [flat(c.first), flat(p.member_name), flat(p.tribe), flat(num(p.missed)), flat(p.leader), flat(c.link("/review/rhythm"))],
  }),
};

const coachLowPulse: TemplateDef = {
  key: "coach_low_pulse",
  audience: "coach",
  title: "A low sense of belonging",
  email: (p, c) => ({
    subject: `${str(p.member_name)} may not be feeling at home`,
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `${str(p.member_name)} in ${str(p.tribe)} (leader: ${str(p.leader)}) scored their sense of belonging low in the week ${num(p.week)} check-in.`,
      "Please talk with the leader about how to include them more, and whether a personal conversation would help.",
    ],
    cta: { label: "Open the weekly report", url: c.link("/review/rhythm") },
  }),
  sms: (p, c) => smsLine(`${str(p.member_name)} in ${str(p.tribe)} scored belonging low. Please follow up with the leader.`, c.link("/review/rhythm")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, {{2}} in {{3}} scored their sense of belonging low this week. Please follow up with the leader, {{4}}. Report: {{5}}",
    example: ["Sade", "Ada Okafor", "Builders Tribe", "Ngozi", "https://unitedtribes.example/review/rhythm"],
    vars: [flat(c.first), flat(p.member_name), flat(p.tribe), flat(p.leader), flat(c.link("/review/rhythm"))],
  }),
};

const coachWelcomeOverdue: TemplateDef = {
  key: "coach_welcome_overdue",
  audience: "coach",
  title: "A new member still has not been called (7 days)",
  email: (p, c) => ({
    subject: `${str(p.member_first)} still hasn’t been called`,
    greeting: `Hi ${c.first},`,
    paragraphs: [`${str(p.member_first)} joined ${str(p.tribe)} over a week ago and ${str(p.leader)} hasn’t marked a welcome call. Please check in with the leader.`],
    cta: { label: "Open the weekly report", url: c.link("/review/rhythm") },
  }),
  sms: (p, c) => smsLine(`${str(p.member_first)} joined ${str(p.tribe)} over a week ago and hasn’t been called. Please check with ${str(p.leader)}.`, c.link("/review/rhythm")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, {{2}} joined {{3}} over a week ago and has not been called yet. Please check with the leader, {{4}}. Report: {{5}}",
    example: ["Sade", "Ada", "Builders Tribe", "Ngozi", "https://unitedtribes.example/review/rhythm"],
    vars: [flat(c.first), flat(p.member_first), flat(p.tribe), flat(p.leader), flat(c.link("/review/rhythm"))],
  }),
};

// ---------------------------------------------------------------------------
// Care (raised by the weekly log)
// ---------------------------------------------------------------------------

const careUrgent: TemplateDef = {
  key: "care_urgent",
  audience: "care",
  title: "Urgent care: same-day response",
  email: (p, c) => ({
    subject: `URGENT care: ${str(p.member)} (${str(p.tribe)})`,
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `${str(p.raised_by)} has flagged an urgent care need for ${str(p.member)} in ${str(p.tribe)}.`,
      ...(str(p.note) ? [`Their note: ${str(p.note)}`] : []),
      "A person should respond today. Please call them, or ask the leader to put you in touch.",
    ],
    cta: { label: "Open the care queue", url: c.link("/care") },
  }),
  sms: (p, c) => smsLine(`URGENT care: ${str(p.member)} (${str(p.tribe)}). Raised by ${str(p.raised_by)}. Please respond today.`, c.link("/care")),
  whatsapp: (p, c) => ({
    body: "URGENT. {{1}}, an urgent care need was raised for {{2}} in {{3}} by {{4}}. A person should respond today. Care queue: {{5}}",
    example: ["Dayo", "Ada Okafor", "Builders Tribe", "Ngozi", "https://unitedtribes.example/care"],
    vars: [flat(c.first), flat(p.member), flat(p.tribe), flat(p.raised_by), flat(c.link("/care"))],
  }),
};

const careTask: TemplateDef = {
  key: "care_task",
  audience: "leader",
  title: "A care task for you (7 days)",
  email: (p, c) => ({
    subject: `A ${str(p.level)} care task: ${str(p.member)}`,
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `${str(p.raised_by)} marked a ${str(p.level)} care need for ${str(p.member)} in ${str(p.tribe)}. It’s been assigned to you, to be seen to by ${shortDay(str(p.due_on))}.`,
      ...(str(p.note) ? [`Their note: ${str(p.note)}`] : []),
      str(p.level) === "practical" ? "Practical care is things like a meal, a lift, help with a form or a job lead." : "Pastoral care is a conversation and prayer. Please do it personally, not by message.",
    ],
    cta: { label: "Open my care tasks", url: c.link("/care") },
  }),
  sms: (p, c) => smsLine(`${str(p.level)} care task for ${str(p.member)} (${str(p.tribe)}), due ${shortDay(str(p.due_on))}.`, c.link("/care")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, a {{2}} care task for {{3}} in {{4}} has been assigned to you. Please see to it by {{5}}. Details: {{6}}",
    example: ["Kemi", "practical", "Ada Okafor", "Builders Tribe", "Fri 19 Feb", "https://unitedtribes.example/care"],
    vars: [flat(c.first), flat(p.level), flat(p.member), flat(p.tribe), flat(shortDay(str(p.due_on))), flat(c.link("/care"))],
  }),
};

const careTaskReminder: TemplateDef = {
  key: "care_task_reminder",
  audience: "leader",
  title: "A care task is due in two days",
  email: (p, c) => ({
    subject: `Due in two days: ${str(p.level)} care for ${str(p.member)}`,
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `A gentle reminder: the ${str(p.level)} care task for ${str(p.member)} in ${str(p.tribe)} is due on ${shortDay(str(p.due_on))}.`,
      "When it is done, mark it done so the leader knows. If it needs more than you can give, say so and the care team will help.",
    ],
    cta: { label: "Open my care tasks", url: c.link("/care") },
  }),
  sms: (p, c) => smsLine(`Reminder: ${str(p.level)} care for ${str(p.member)} (${str(p.tribe)}) is due ${shortDay(str(p.due_on))}.`, c.link("/care")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, a reminder: the {{2}} care task for {{3}} in {{4}} is due on {{5}}. Open it here: {{6}}",
    example: ["Kemi", "practical", "Ada Okafor", "Builders Tribe", "Fri 19 Feb", "https://unitedtribes.example/care"],
    vars: [flat(c.first), flat(p.level), flat(p.member), flat(p.tribe), flat(shortDay(str(p.due_on))), flat(c.link("/care"))],
  }),
};

const careTaskOverdue: TemplateDef = {
  key: "care_task_overdue",
  audience: "care",
  title: "A care task is late",
  email: (p, c) => {
    const urgent = str(p.level) === "urgent";
    return {
      subject: urgent ? `Still waiting: urgent care for ${str(p.member)}` : `Late: ${str(p.level)} care for ${str(p.member)}`,
      greeting: `Hi ${c.first},`,
      paragraphs: [
        urgent
          ? `An urgent care need for ${str(p.member)} in ${str(p.tribe)} has had no answer for four hours. It is with ${str(p.assignee)}.`
          : `The ${str(p.level)} care task for ${str(p.member)} in ${str(p.tribe)} was due on ${shortDay(str(p.due_on))} and is still open. It is with ${str(p.assignee)}.`,
        "Please check that someone has reached them, and pass the task on if it needs a different person.",
      ],
      cta: { label: "Open the care tasks", url: c.link("/care") },
    };
  },
  sms: (p, c) => smsLine(`${str(p.level) === "urgent" ? "URGENT, no answer yet" : "Care task late"}: ${str(p.member)} (${str(p.tribe)}).`, c.link("/care")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, the {{2}} care task for {{3}} in {{4}} is still open and needs a person. It is with {{5}}. Care tasks: {{6}}",
    example: ["Dayo", "pastoral", "Ada Okafor", "Builders Tribe", "the coach", "https://unitedtribes.example/care"],
    vars: [flat(c.first), flat(p.level), flat(p.member), flat(p.tribe), flat(p.assignee), flat(c.link("/care"))],
  }),
};

const coachHelp: TemplateDef = {
  key: "coach_help",
  audience: "coach",
  title: "A leader asked for their coach",
  email: (p, c) => ({
    subject: `${str(p.leader)} would like your help`,
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `${str(p.leader)} ticked “I need my coach” when logging week ${num(p.week)} of ${str(p.tribe)}.`,
      ...(str(p.note) ? [`They wrote: ${str(p.note)}`] : []),
      `Please call them by ${shortDay(str(p.due_on))}.`,
    ],
    cta: { label: "Open my care tasks", url: c.link("/care") },
  }),
  sms: (p, c) => smsLine(`${str(p.leader)} (${str(p.tribe)}) asked for their coach. Please call them this week.`, c.link("/care")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, {{2}} of {{3}} asked for their coach when logging week {{4}}. Please call them by {{5}}. Details: {{6}}",
    example: ["Sade", "Ngozi", "Builders Tribe", "3", "Fri 19 Feb", "https://unitedtribes.example/care"],
    vars: [flat(c.first), flat(p.leader), flat(p.tribe), flat(num(p.week)), flat(shortDay(str(p.due_on))), flat(c.link("/care"))],
  }),
};

const KIND_PHRASE: Record<string, string> = {
  new_baby: "a new baby",
  anniversary: "an anniversary",
  promotion: "a promotion",
  milestone: "a milestone",
  answered_prayer: "an answered prayer",
  other: "something to celebrate",
};

const celebrationPrompt: TemplateDef = {
  key: "celebration_prompt",
  audience: "leader",
  title: "Something to celebrate in your tribe",
  email: (p, c) => {
    const who = str(p.first_name);
    const what = KIND_PHRASE[str(p.kind)] ?? "something to celebrate";
    const note = str(p.note);
    return {
      subject: who ? `Celebrate with ${who}` : `Something to celebrate in ${str(p.tribe)}`,
      greeting: `Hi ${c.first},`,
      paragraphs: [
        `${who ? `${who} has ${what}` : `Your tribe has ${what}`}${note ? `: ${note}` : ""}. A short word in the group tonight will mean a lot.`,
        ...(str(p.group_url) ? [`Your tribe’s WhatsApp group: ${str(p.group_url)}`] : []),
      ],
      cta: { label: "Open this week", url: c.link("/lead/week") },
    };
  },
  sms: (p, c) => smsLine(`${str(p.first_name) ? `${str(p.first_name)} has ` : "Your tribe has "}${KIND_PHRASE[str(p.kind)] ?? "something to celebrate"}. Say a word of thanks to God together.`, c.link("/lead/week")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, there is something to celebrate in {{2}}: {{3}}. A short word in the group will mean a lot. This week: {{4}}",
    example: ["Ngozi", "Builders Tribe", "Ada has a new baby", "https://unitedtribes.example/lead/week"],
    vars: [
      flat(c.first),
      flat(p.tribe),
      flat(`${str(p.first_name) ? `${str(p.first_name)} has ` : "your tribe has "}${KIND_PHRASE[str(p.kind)] ?? "something to celebrate"}`),
      flat(c.link("/lead/week")),
    ],
  }),
};

// ---------------------------------------------------------------------------
// People applying to lead
// ---------------------------------------------------------------------------

/**
 * What happens next, in words that fit the steps this application goes through. The database adds refs: false, refs_optional: true or
 * interview: false to the message only when a step does not apply, so with every step asked this is the sentence it has always been.
 */
export function receivedNext(p: Params): string {
  const noRefs = p.refs === false;
  const optionalRefs = p.refs_optional === true;
  const noInterview = p.interview === false;
  const read = noRefs ? "Next, we read it" : optionalRefs ? "Next, we read it, together with your references if you added any" : "Next, we read it together with your references";
  if (noInterview) return `${read}, and a pastor decides. You’ll hear from us at each step.`;
  return `${read}. If everything is in order we’ll invite you to a short conversation. You’ll hear from us at each step.`;
}

const applicationReceived: TemplateDef = {
  key: "application_received",
  audience: "applicant",
  title: "Your application was received",
  email: (p, c) => ({
    subject: "We’ve received your leader application",
    greeting: `Hi ${c.first},`,
    paragraphs: [
      "Thank you for offering to lead. Your application is with us.",
      receivedNext(p),
    ],
    cta: { label: "See my application", url: c.link("/lead") },
  }),
  sms: (_p, c) => smsLine("We’ve received your leader application. You’ll hear from us at each step.", c.link("/lead")),
  whatsapp: (_p, c) => ({
    body: "Hi {{1}}, we have received your leader application. Thank you for offering to lead. You will hear from us at each step. {{2}}",
    example: ["Ngozi", "https://unitedtribes.example/lead"],
    vars: [flat(c.first), flat(c.link("/lead"))],
  }),
};

const applicationInterviewInvited: TemplateDef = {
  key: "application_interview_invited",
  audience: "applicant",
  title: "You’re invited to a conversation",
  email: (p, c) => ({
    subject: "You’re invited to a short conversation",
    greeting: `Hi ${c.first},`,
    paragraphs: ["Thank you for your application. We’d like to talk with you for about twenty minutes. Please pick a time that suits you."],
    cta: { label: "Choose a time", url: c.link("/lead") },
  }),
  sms: (_p, c) => smsLine("You’re invited to a 20-minute conversation about leading. Choose a time:", c.link("/lead")),
  whatsapp: (_p, c) => ({
    body: "Hi {{1}}, thank you for your application. We would like to talk with you for about twenty minutes. Please choose a time: {{2}}",
    example: ["Ngozi", "https://unitedtribes.example/lead"],
    vars: [flat(c.first), flat(c.link("/lead"))],
  }),
};

const applicationInterviewBooked: TemplateDef = {
  key: "application_interview_booked",
  audience: "applicant",
  title: "Your conversation is booked",
  email: (p, c) => ({
    subject: "Your conversation is booked",
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `Your conversation is ${str(p.starts_at_label) ? `on ${str(p.starts_at_label)}` : "booked"}${str(p.mode) === "online" ? ", online" : ""}. ${str(p.place) ? `${str(p.mode) === "online" ? "Link" : "Where"}: ${str(p.place)}` : ""}`.trim(),
      `It lasts about ${num(p.minutes, 20)} minutes. Just be yourself.`,
    ],
    cta: { label: "See my application", url: c.link("/lead") },
  }),
  sms: (p, c) => smsLine(`Your leader conversation is ${str(p.starts_at_label) ? `on ${str(p.starts_at_label)}` : "booked"}.`, c.link("/lead")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, your leader conversation is booked for {{2}}. {{3}} It lasts about {{4}} minutes.",
    example: ["Ngozi", "Mon 9 Nov, 4:00 pm", "Link: https://meet.example.org/abc", "20"],
    vars: [flat(c.first), flat(p.starts_at_label, "the time you chose"), flat(str(p.place) ? `${str(p.mode) === "online" ? "Link" : "Where"}: ${str(p.place)}` : ""), flat(num(p.minutes, 20))],
  }),
};

/**
 * The line that says what comes after approval, for the application_approved message. The database adds declaration: false only when
 * the signed declaration is switched off, so with the Academy and the declaration both required this is the sentence it has always been.
 */
export function approvedNext(p: Params): string {
  if (p.declaration === false) return "Next is the Leader Academy: six short modules and two workshops. Open it whenever you’re ready.";
  return "Next is the Leader Academy: six short modules, a safeguarding declaration, and two workshops. Open it whenever you’re ready.";
}

const REACH_OUT = "Please also tell us how you’d like to be reached, so the reminders you need can find you.";

const applicationApproved: TemplateDef = {
  key: "application_approved",
  audience: "applicant",
  title: "You’ve been approved",
  email: (p, c) => ({
    subject: `Welcome: you’re approved as ${str(p.role, "a leader")}`,
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `Good news: you have been approved as ${str(p.role, "a leader")}. Thank you for saying yes.`,
      approvedNext(p),
      REACH_OUT,
    ],
    cta: { label: "Start the Academy", url: c.link("/lead/academy") },
  }),
  sms: (p, c) => smsLine(`You’re approved as ${str(p.role, "a leader")}. Start the Academy:`, c.link("/lead/academy")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, good news: you have been approved as {{2}}. Thank you for saying yes. Next is the Leader Academy: {{3}}",
    example: ["Ngozi", "tribe leader", "https://unitedtribes.example/lead/academy"],
    vars: [flat(c.first), flat(str(p.role, "a leader")), flat(c.link("/lead/academy"))],
  }),
};

// The three other ways an approval can read, chosen by the database (leader_approved_template) from the Academy and declaration switches.
// Each is its own template, because the wording of a WhatsApp template is fixed when Meta approves it.

/** The Academy is optional: open to the new leader, not asked of them. The declaration line follows its own switch. */
const applicationApprovedOptional: TemplateDef = {
  key: "application_approved_optional",
  audience: "applicant",
  title: "You’ve been approved (Academy optional)",
  email: (p, c) => ({
    subject: `Welcome: you’re approved as ${str(p.role, "a leader")}`,
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `Good news: you have been approved as ${str(p.role, "a leader")}. Thank you for saying yes.`,
      p.declaration === false
        ? "The Leader Academy is open to you whenever you want it: six short modules and two workshops. It is optional, so take it when it will help you."
        : "The Leader Academy is open to you whenever you want it: six short modules and two workshops. It is optional. What we do ask is that you sign the safeguarding declaration.",
      REACH_OUT,
    ],
    cta: { label: "Open the Academy", url: c.link("/lead/academy") },
  }),
  sms: (p, c) => smsLine(`You’re approved as ${str(p.role, "a leader")}. The Academy is open to you, and optional:`, c.link("/lead/academy")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, good news: you have been approved as {{2}}. Thank you for saying yes. The Leader Academy is open to you whenever you want it, and it is optional: {{3}}",
    example: ["Ngozi", "tribe leader", "https://unitedtribes.example/lead/academy"],
    vars: [flat(c.first), flat(str(p.role, "a leader")), flat(c.link("/lead/academy"))],
  }),
};

/** The Academy is off and the signed declaration is still asked for. */
const applicationApprovedDeclaration: TemplateDef = {
  key: "application_approved_declaration",
  audience: "applicant",
  title: "You’ve been approved (declaration only)",
  email: (p, c) => ({
    subject: `Welcome: you’re approved as ${str(p.role, "a leader")}`,
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `Good news: you have been approved as ${str(p.role, "a leader")}. Thank you for saying yes.`,
      "Next is a short safeguarding declaration, which every leader signs. It takes a few minutes.",
      REACH_OUT,
    ],
    cta: { label: "Sign the declaration", url: c.link("/lead/academy/declaration") },
  }),
  sms: (p, c) => smsLine(`You’re approved as ${str(p.role, "a leader")}. Please sign the safeguarding declaration:`, c.link("/lead/academy/declaration")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, good news: you have been approved as {{2}}. Thank you for saying yes. Next is a short safeguarding declaration that every leader signs: {{3}}",
    example: ["Ngozi", "tribe leader", "https://unitedtribes.example/lead/academy/declaration"],
    vars: [flat(c.first), flat(str(p.role, "a leader")), flat(c.link("/lead/academy/declaration"))],
  }),
};

/** The Academy and the declaration are both off. A tribe leader's next step is the Tribe Card; an assistant leader has none. */
const applicationApprovedOpen: TemplateDef = {
  key: "application_approved_open",
  audience: "applicant",
  title: "You’ve been approved (nothing to complete first)",
  email: (p, c) => {
    const assistant = str(p.role) === "assistant leader";
    return {
      subject: `Welcome: you’re approved as ${str(p.role, "a leader")}`,
      greeting: `Hi ${c.first},`,
      paragraphs: [
        `Good news: you have been approved as ${str(p.role, "a leader")}. Thank you for saying yes.`,
        assistant
          ? "There is nothing to complete before you start. Your tribe leader will be in touch about your tribe."
          : "Next is your Tribe Card. It is how a member decides on your tribe, it takes about twenty minutes, and it saves as you type.",
        REACH_OUT,
      ],
      cta: { label: assistant ? "See my page" : "Start my Tribe Card", url: c.link(assistant ? "/lead" : "/lead/tribe") },
    };
  },
  sms: (p, c) => smsLine(`You’re approved as ${str(p.role, "a leader")}. See what comes next:`, c.link("/lead")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, good news: you have been approved as {{2}}. Thank you for saying yes. Open your page to see what comes next: {{3}}",
    example: ["Ngozi", "tribe leader", "https://unitedtribes.example/lead"],
    vars: [flat(c.first), flat(str(p.role, "a leader")), flat(c.link("/lead"))],
  }),
};

const applicationNotApproved: TemplateDef = {
  key: "application_not_approved",
  audience: "applicant",
  title: "A decision on your application",
  email: (p, c) => ({
    subject: "About your leader application",
    greeting: `Hi ${c.first},`,
    paragraphs: [
      "Thank you for offering to lead and for the care you put into your application. We are not able to approve it for this season.",
      "This is not a verdict on you. Please open your application to read the note from the pastorate, and speak with a pastor or coach if you’d like to talk about it. You are warmly welcome in a tribe as a member.",
    ],
    cta: { label: "Read the note", url: c.link("/lead") },
  }),
  sms: (_p, c) => smsLine("There is an update on your leader application. Please open it to read the note:", c.link("/lead")),
  whatsapp: (_p, c) => ({
    body: "Hi {{1}}, there is an update on your leader application. Thank you for offering to lead. Please open it to read the note from the pastorate: {{2}}",
    example: ["Ngozi", "https://unitedtribes.example/lead"],
    vars: [flat(c.first), flat(c.link("/lead"))],
  }),
};

// The first check on a leader application. Kind, short, and never about how anything was read: no score, no flag, and
// no mention of a computer. The database decides when each one is sent (supabase/migrations/…leader_ai_scoring.sql).

const leaderCheckConsent: TemplateDef = {
  key: "leader_check_consent",
  audience: "applicant",
  title: "One sentence on your application has changed",
  email: (_p, c) => ({
    subject: "Please read one new sentence on your application",
    greeting: `Hi ${c.first},`,
    paragraphs: [
      "Thank you for applying to lead. We have changed one sentence in the agreement on your application. Nothing else about it is different, and your answers are safe.",
      "Please open your application, read it, and agree so we can carry on.",
    ],
    cta: { label: "Read it and agree", url: c.link("/lead") },
  }),
  sms: (_p, c) => smsLine("We changed one sentence on your leader application. Please read it and agree so we can carry on:", c.link("/lead")),
  whatsapp: (_p, c) => ({
    body: "Hi {{1}}, we have changed one sentence in the agreement on your leader application. Nothing else is different. Please read it and agree so we can carry on: {{2}}",
    example: ["Ngozi", "https://unitedtribes.example/lead"],
    vars: [flat(c.first), flat(c.link("/lead"))],
  }),
};

const leaderCheckStrengthen: TemplateDef = {
  key: "leader_check_strengthen",
  audience: "applicant",
  title: "A little more would help your application",
  email: (p, c) => ({
    subject: "A little more would help your application",
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `Thank you for your application. ${num(p.count, 1) === 1 ? "One answer" : "A few answers"} would be stronger with a few more words, and we have said what to add.`,
      "Open your application to see it. You can add to your answers in your own words, or ask for a person to read it as it is. Your referees’ links open once this is done.",
    ],
    cta: { label: "See what to add", url: c.link("/lead") },
  }),
  sms: (_p, c) => smsLine("A little more would help your leader application. See what to add, or ask for a person to read it as it is:", c.link("/lead")),
  whatsapp: (_p, c) => ({
    body: "Hi {{1}}, thank you for your application. A little more would help it. You can add to your answers in your own words, or ask for a person to read it as it is: {{2}}",
    example: ["Ngozi", "https://unitedtribes.example/lead"],
    vars: [flat(c.first), flat(c.link("/lead"))],
  }),
};

const leaderCheckClear: TemplateDef = {
  key: "leader_check_clear",
  audience: "applicant",
  title: "Your referees’ links are ready",
  email: (_p, c) => ({
    subject: "Your referees’ links are ready",
    greeting: `Hi ${c.first},`,
    paragraphs: [
      "Thank you for your application. We have read it, and the panel will take it from here.",
      "One more step: send each of your two referees their private link. Interview invitations wait until both have answered.",
    ],
    cta: { label: "Send my referees their links", url: c.link("/lead") },
  }),
  sms: (_p, c) => smsLine("Your leader application has been read. Next, send each referee their private link:", c.link("/lead")),
  whatsapp: (_p, c) => ({
    body: "Hi {{1}}, your leader application has been read and the panel will take it from here. Next, please send each of your two referees their private link: {{2}}",
    example: ["Ngozi", "https://unitedtribes.example/lead"],
    vars: [flat(c.first), flat(c.link("/lead"))],
  }),
};

// The same message when references are not asked, or are optional. They are their own templates, so the wording Meta approved for
// leader_check_clear is never changed. The database picks which one to send (leader_check_template).
const leaderCheckClearOpen: TemplateDef = {
  key: "leader_check_clear_open",
  audience: "applicant",
  title: "Your application has been read",
  email: (_p, c) => ({
    subject: "Your application has been read",
    greeting: `Hi ${c.first},`,
    paragraphs: [
      "Thank you for your application. We have read it, and the panel will take it from here.",
      "Nothing more is needed from you now. You’ll hear from us at each step.",
    ],
    cta: { label: "See my application", url: c.link("/lead") },
  }),
  sms: (_p, c) => smsLine("Your leader application has been read. You’ll hear from us at each step:", c.link("/lead")),
  whatsapp: (_p, c) => ({
    body: "Hi {{1}}, your leader application has been read and the panel will take it from here. You will hear from us at each step: {{2}}",
    example: ["Ngozi", "https://unitedtribes.example/lead"],
    vars: [flat(c.first), flat(c.link("/lead"))],
  }),
};

const leaderCheckClearOptional: TemplateDef = {
  key: "leader_check_clear_optional",
  audience: "applicant",
  title: "Your application has been read (referees optional)",
  email: (_p, c) => ({
    subject: "Your application has been read",
    greeting: `Hi ${c.first},`,
    paragraphs: [
      "Thank you for your application. We have read it, and the panel will take it from here.",
      "If you added referees, you can send each of them their private link now. The panel does not wait for them.",
    ],
    cta: { label: "See my application", url: c.link("/lead") },
  }),
  sms: (_p, c) => smsLine("Your leader application has been read. If you added referees, send each their private link:", c.link("/lead")),
  whatsapp: (_p, c) => ({
    body: "Hi {{1}}, your leader application has been read and the panel will take it from here. If you added referees, please send each of them their private link: {{2}}",
    example: ["Ngozi", "https://unitedtribes.example/lead"],
    vars: [flat(c.first), flat(c.link("/lead"))],
  }),
};

// ---------------------------------------------------------------------------
// Sign-in codes on WhatsApp: alerts for the people who run it. Email only, and never any code or number.
// ---------------------------------------------------------------------------

export const SIGNIN_REASONS: Record<string, string> = {
  failed_sends: "too many WhatsApp codes failed to send",
  rejections: "WhatsApp refused too many codes",
  no_receipts: "most recent codes show no sign of arriving",
  stop_spike: "several people replied STOP or “not me”",
  sender_logged_out: "the sending number was logged out of WhatsApp",
  sender_restricted: "WhatsApp restricted the sending number",
  sender_unreachable: "the sending service could not be reached for a while",
};

const signinPaused: TemplateDef = {
  key: "signin_paused",
  audience: "office",
  emailOnly: true,
  title: "WhatsApp sign-in codes have paused themselves",
  email: (p, c) => ({
    subject: "WhatsApp sign-in codes are paused",
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `WhatsApp sign-in codes stopped by themselves because ${SIGNIN_REASONS[str(p.reason)] ?? "something looked wrong"}. Everyone can still sign in with Google or a code by email.`,
      "Nothing turns it back on by itself. When you have looked into it, open the page below and turn WhatsApp codes back on.",
    ],
    cta: { label: "Open WhatsApp sign-in", url: c.link("/admin/signin") },
  }),
  sms: (_p, c) => smsLine("WhatsApp sign-in codes have paused themselves. Email sign-in still works. Look into it here:", c.link("/admin/signin")),
  whatsapp: (_p, c) => ({
    body: "Hi {{1}}, WhatsApp sign-in codes have paused themselves and email sign-in still works. Please look into it and turn them back on here: {{2}}",
    example: ["Ngozi", "https://unitedtribes.example/admin/signin"],
    vars: [flat(c.first), flat(c.link("/admin/signin"))],
  }),
};

const signinStopAlert: TemplateDef = {
  key: "signin_stop_alert",
  audience: "office",
  emailOnly: true,
  title: "Someone replied STOP or “not me” to a sign-in code",
  email: (p, c) => ({
    subject: "Someone replied to a WhatsApp sign-in code",
    greeting: `Hi ${c.first},`,
    paragraphs: [
      str(p.kind) === "not_me"
        ? "Someone replied “not me” to a WhatsApp sign-in code, so a code was sent to a number whose owner did not ask for it."
        : "Someone replied STOP to a WhatsApp sign-in code.",
      "No more codes will go to that number for 30 days. If this keeps happening, WhatsApp codes pause themselves and you will be told.",
    ],
    cta: { label: "Open WhatsApp sign-in", url: c.link("/admin/signin") },
  }),
  sms: (_p, c) => smsLine("Someone replied STOP or “not me” to a WhatsApp sign-in code. Codes to that number are blocked for 30 days:", c.link("/admin/signin")),
  whatsapp: (_p, c) => ({
    body: "Hi {{1}}, someone replied STOP or not me to a WhatsApp sign-in code, so codes to that number are blocked for 30 days. See the details here: {{2}}",
    example: ["Ngozi", "https://unitedtribes.example/admin/signin"],
    vars: [flat(c.first), flat(c.link("/admin/signin"))],
  }),
};

// ---------------------------------------------------------------------------
// An offer to lead (the supply-and-demand board, Phase 7)
// ---------------------------------------------------------------------------

const NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];

/** "Nine people are waiting": a small count in words, a larger one in figures. A count is all an offer ever says about the members. */
export function waitingPhrase(count: unknown): string {
  const n = Math.max(1, Math.floor(Number(count)) || 1);
  const figure = n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n);
  return n === 1 ? "One person is waiting" : `${figure} people are waiting`;
}

/** The goal in words; a blank one reads as "a tribe" rather than leaving a gap in the sentence. */
const goalName = (goal: unknown): string => str(goal).trim() || "a tribe";

const leaderOffer: TemplateDef = {
  key: "leader_offer",
  audience: "leader",
  // Email first. A WhatsApp version has to be approved by Meta before it can be sent, so this one is never put to Meta.
  emailOnly: true,
  title: "An offer to lead a tribe where members are waiting",
  email: (p, c) => ({
    subject: `Would you lead ${goalName(p.goal)} this season?`,
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `${waitingPhrase(p.waiting)} for ${goalName(p.goal)}. Would you lead it this season?`,
      "If you say yes, your Tribe Card starts with the goal already chosen and the three lines of the Success Picture written for you to make your own. A pastor still approves the card, as always.",
      str(p.expires_on) ? `The offer stays open until ${str(p.expires_on)}. If now is not the right time, tell us on the same page. Nothing changes for you.` : "If now is not the right time, tell us on the same page. Nothing changes for you.",
    ],
    cta: { label: "See the offer", url: c.link("/lead") },
  }),
  sms: (p, c) => smsLine(`${waitingPhrase(p.waiting)} for ${goalName(p.goal)}. Would you lead it this season? See the offer:`, c.link("/lead")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, {{2}} for {{3}}. Would you lead it this season? See the offer and answer here: {{4}}",
    example: ["Ngozi", "Nine people are waiting", "Win my first ten paying customers", "https://unitedtribes.example/lead"],
    vars: [flat(c.first), flat(waitingPhrase(p.waiting)), flat(goalName(p.goal)), flat(c.link("/lead"))],
  }),
};

// ---------------------------------------------------------------------------
// A referee, with no account
// ---------------------------------------------------------------------------

// The link and the code are made by the database at the moment the message goes out (claim_prepare), so neither is ever stored or shown
// to the applicant. `secret` is the end of the link; `code` is the six digits.
const refereeRequest: TemplateDef = {
  key: "referee_request",
  audience: "referee",
  title: "A reference is requested",
  email: (p, c) => ({
    subject: `${str(p.applicant)} has asked you to speak for them`,
    greeting: `Dear ${salutation(str(p.referee))},`,
    paragraphs: [
      `${str(p.applicant)} is applying to lead a small group at The Covenant Nation and has named you as a referee: someone who knows them well enough to speak for them.`,
      "It takes about two minutes. First we send a six-digit code to this same address, so we know the reference really comes from you. Then four short questions.",
      `What you say goes only to the pastoral team. ${str(p.applicant_first) || "The applicant"} never sees it. If this was not expected, you can ignore this message: nothing happens unless you open the link.`,
      `The link is for you alone, so please do not forward it. It stays open for ${num(p.days, 30)} days.`,
    ],
    cta: { label: "Give a reference", url: c.link(`/reference/${str(p.secret)}`) },
  }),
  sms: (p, c) => smsLine(`${str(p.applicant)} asked you for a leadership reference at The Covenant Nation (2 minutes, private). Link just for you:`, c.link(`/reference/${str(p.secret)}`)),
  whatsapp: (p, c) => ({
    body: "Dear {{1}}, {{2}} has asked you for a reference as they apply to lead a small group at The Covenant Nation. It takes two minutes and your answers stay private to the pastoral team. We will send a code to this number to make sure it is you. Your link: {{3}}",
    example: ["Pastor Femi", "Ngozi Okafor", "https://unitedtribes.example/reference/abc"],
    vars: [flat(salutation(str(p.referee))), flat(p.applicant), flat(c.link(`/reference/${str(p.secret)}`))],
  }),
};

const refereeCode: TemplateDef = {
  key: "referee_code",
  audience: "referee",
  title: "A referee's six-digit code",
  email: (p) => ({
    subject: `${str(p.code)} is your code for the reference`,
    greeting: `Dear ${salutation(str(p.referee))},`,
    paragraphs: [
      `Your code is ${str(p.code)}.`,
      `Type it on the page where you opened your link. It works for ${num(p.minutes, 10)} minutes and only once.`,
      "If you did not ask for this, ignore it. Nobody can use the code without your private link.",
    ],
  }),
  sms: (p) => `United Tribes code: ${str(p.code)}. It lasts ${num(p.minutes, 10)} minutes. Do not share it.`,
  whatsapp: (p) => ({
    body: "Your United Tribes code is {{1}}. It lasts {{2}} minutes. Please do not share it with anyone.",
    example: ["482913", "10"],
    vars: [flat(p.code), flat(num(p.minutes, 10))],
  }),
};

const refereeReverify: TemplateDef = {
  key: "referee_reverify",
  audience: "referee",
  title: "A referee is asked to confirm a reference they gave",
  email: (p, c) => ({
    subject: `Please confirm your reference for ${str(p.applicant)}`,
    greeting: `Dear ${salutation(str(p.referee))},`,
    paragraphs: [
      `Thank you for the reference you gave for ${str(p.applicant)}, who is applying to lead a small group at The Covenant Nation.`,
      "We now check that every reference really comes from the person named. Could you confirm yours? We send a six-digit code to this same address, and you tell us the reference was yours. It takes one minute, and nothing you wrote changes.",
      `The link is for you alone and stays open for ${num(p.days, 30)} days.`,
    ],
    cta: { label: "Confirm my reference", url: c.link(`/reference/${str(p.secret)}`) },
  }),
  sms: (p, c) => smsLine(`Please confirm the reference you gave for ${str(p.applicant)} at The Covenant Nation (1 minute):`, c.link(`/reference/${str(p.secret)}`)),
  whatsapp: (p, c) => ({
    body: "Dear {{1}}, thank you for the reference you gave for {{2}} at The Covenant Nation. We now check that each one comes from the person named. Please confirm yours, it takes a minute and nothing you wrote changes: {{3}}",
    example: ["Pastor Femi", "Ngozi Okafor", "https://unitedtribes.example/reference/abc"],
    vars: [flat(salutation(str(p.referee))), flat(p.applicant), flat(c.link(`/reference/${str(p.secret)}`))],
  }),
};

const reportReady: TemplateDef = {
  key: "report_ready",
  audience: "office",
  title: "A report is ready",
  email: (p, c) => ({
    subject: `${str(p.title)}: ${str(p.period)}`,
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `${str(p.title)} for ${str(p.period)} is ready to read.`,
      "It is worked out from the same figures as the dashboard, with a short summary at the top that you can reword before you share it.",
    ],
    cta: { label: "Open the report", url: c.link(`/reports/${str(p.report_id)}`) },
  }),
  sms: (p, c) => smsLine(`${str(p.title)} for ${str(p.period)} is ready.`, c.link(`/reports/${str(p.report_id)}`)),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, {{2}} for {{3}} is ready to read. Open it here: {{4}}",
    example: ["Pastor Femi", "The pastorate one-pager", "September 2026", "https://unitedtribes.example/reports/abc"],
    vars: [flat(c.first), flat(p.title), flat(p.period), flat(c.link(`/reports/${str(p.report_id)}`))],
  }),
};

// ---------------------------------------------------------------------------
// Changing tribe
// ---------------------------------------------------------------------------

// The reason a member gives is never in a message: it stays in the request, seen by the coach, the Care Lead and directors.
const swapRequested: TemplateDef = {
  key: "swap_requested",
  audience: "coach",
  title: "A member has asked to change tribe",
  email: (p, c) => ({
    subject: `${first(p, "person_first", "A member")} would like to change tribe`,
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `${first(p, "person_first", "A member")} from ${str(p.tribe)} has asked to move to a different tribe.`,
      "Please speak to them this week. If a move would help, you can offer one of the tribes that fit their time, place and life stage. The reason they gave is in the request, and goes no further than you, the Care Lead and the directors.",
    ],
    cta: { label: "Open the request", url: c.link("/growth/swaps") },
  }),
  sms: (p, c) => smsLine(`${first(p, "person_first", "A member")} (${str(p.tribe)}) has asked to change tribe. Please speak to them this week.`, c.link("/growth/swaps")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, {{2}} from {{3}} has asked to change tribe. Please speak to them this week. The request: {{4}}",
    example: ["Dayo", "Ada", "Builders Tribe", "https://unitedtribes.example/growth/swaps"],
    vars: [flat(c.first), flat(first(p, "person_first", "A member")), flat(p.tribe), flat(c.link("/growth/swaps"))],
  }),
};

const swapOffered: TemplateDef = {
  key: "swap_offered",
  audience: "member",
  title: "A tribe that could suit you",
  email: (p, c) => ({
    subject: "A tribe that could suit you",
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `${first(p, "by_first", "Your coach")} has found a tribe for you: ${str(p.tribe)}.`,
      "Have a look at when and where it meets, and who leads it, then say yes or no. Nothing changes until you say yes, and you stay where you are until then.",
    ],
    cta: { label: "See the tribe", url: c.link("/tribe") },
  }),
  sms: (p, c) => smsLine(`${first(p, "by_first", "Your coach")} has found a tribe that could suit you: ${str(p.tribe)}. Nothing changes until you say yes.`, c.link("/tribe")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, {{2}} has found a tribe that could suit you: {{3}}. Nothing changes until you say yes. See it here: {{4}}",
    example: ["Ada", "Dayo", "Builders Tribe", "https://unitedtribes.example/tribe"],
    vars: [flat(c.first), flat(first(p, "by_first", "Your coach")), flat(p.tribe), flat(c.link("/tribe"))],
  }),
};

const swapDeclined: TemplateDef = {
  key: "swap_declined",
  audience: "member",
  title: "About your request to change tribe",
  email: (p, c) => ({
    subject: "About your request to change tribe",
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `${first(p, "by_first", "Your coach")} has read your request and could not find a move that works right now.`,
      "There may be a note for you on your tribe page. You are still in your tribe, and your coach would be glad to talk about what would help.",
    ],
    cta: { label: "Open my tribe", url: c.link("/tribe") },
  }),
  sms: (p, c) => smsLine(`${first(p, "by_first", "Your coach")} has replied to your request to change tribe. There is a note on your tribe page.`, c.link("/tribe")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, {{2}} has replied to your request to change tribe. There is a note for you on your tribe page: {{3}}",
    example: ["Ada", "Dayo", "https://unitedtribes.example/tribe"],
    vars: [flat(c.first), flat(first(p, "by_first", "Your coach")), flat(c.link("/tribe"))],
  }),
};

// Neither leader is told where the person came from or went to, or why.
const swapMoved: TemplateDef = {
  key: "swap_moved",
  audience: "leader",
  title: "A member has moved tribe",
  email: (p, c) => {
    const person = first(p, "person_first", "A member");
    return str(p.direction) === "in"
      ? {
          subject: `${person} is joining your tribe`,
          greeting: `Hi ${c.first},`,
          paragraphs: [
            `${person} is joining your tribe from another one, a little way into the season.`,
            "Please say hello within three days, and bring them up to date with where the tribe is in its twelve weeks.",
          ],
          cta: { label: "Open my tribe", url: c.link("/lead/tribe") },
        }
      : {
          subject: `${person} has moved to another tribe`,
          greeting: `Hi ${c.first},`,
          paragraphs: [
            `${person} has moved to another tribe, after talking with a coach.`,
            "There is nothing you need to do. If you would like to, a kind word of thanks for the time they spent with you will be remembered.",
          ],
          cta: { label: "Open my tribe", url: c.link("/lead/tribe") },
        };
  },
  sms: (p, c) =>
    smsLine(
      str(p.direction) === "in"
        ? `${first(p, "person_first", "A member")} is joining your tribe from another one. Please say hello within 3 days.`
        : `${first(p, "person_first", "A member")} has moved to another tribe. Nothing you need to do.`,
      c.link("/lead/tribe"),
    ),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, a quick update about your tribe. {{2}} {{3}} You can see your tribe here: {{4}}",
    example: ["Ngozi", "Ada is joining your tribe from another one.", "Please say hello within three days.", "https://unitedtribes.example/lead/tribe"],
    vars: [
      flat(c.first),
      flat(`${first(p, "person_first", "A member")} ${str(p.direction) === "in" ? "is joining your tribe from another one." : "has moved to another tribe."}`),
      flat(str(p.direction) === "in" ? "Please say hello within three days." : "There is nothing you need to do."),
      flat(c.link("/lead/tribe")),
    ],
  }),
};

// ---------------------------------------------------------------------------
// A parent or guardian, with no account
// ---------------------------------------------------------------------------

// The private link is built here from the secret the database put in the message. The database removes the secret
// from the outbox as soon as the message has been sent, so no copy of a working link is kept.
const guardianRequest: TemplateDef = {
  key: "guardian_request",
  audience: "guardian",
  title: "A parent or guardian is asked for permission",
  email: (p, c) => ({
    subject: `${first(p, "teen_first", "Your young person")} would like to join a small group at The Covenant Nation`,
    greeting: `Dear ${str(p.guardian) || c.first},`,
    paragraphs: [
      `${first(p, "teen_first", "Your young person")} would like to join a tribe in United Tribes at The Covenant Nation: a small group of up to twelve people who meet for twelve weeks to pray, learn and take one practical step each week.`,
      "Because they are under 18, we need your permission first. Please read what is involved and give your answer. It takes about three minutes and needs no sign-in.",
      "Someone from our Care Team will also phone you to check that the answer came from you. You can take your permission back at any time.",
    ],
    cta: { label: "Read and answer", url: c.link(`/guardian/${str(p.token)}`) },
  }),
  sms: (p, c) => smsLine(`${first(p, "teen_first", "Your young person")} wants to join a small group at The Covenant Nation and needs your permission (3 minutes, private):`, c.link(`/guardian/${str(p.token)}`)),
  whatsapp: (p, c) => ({
    body: "Dear {{1}}, {{2}} would like to join a small group at The Covenant Nation and needs your permission because they are under 18. It takes three minutes. Link: {{3}}",
    example: ["Mrs Okafor", "Ada", "https://unitedtribes.example/guardian/abc"],
    vars: [flat(str(p.guardian) || c.first, "parent or guardian"), flat(first(p, "teen_first", "Your young person")), flat(c.link(`/guardian/${str(p.token)}`))],
  }),
};

const guardianUpdate: TemplateDef = {
  key: "guardian_update",
  audience: "care",
  title: "A parent or guardian has answered",
  email: (p, c) => {
    const teen = first(p, "teen_first", "A young person");
    const what = str(p.what);
    const [subject, body] =
      what === "approved"
        ? [`${teen}’s parent or guardian said yes`, `Their parent or guardian has given permission. Please phone them to check that it was really them, then mark it confirmed. Until you do, ${teen} cannot see tribes.`]
        : what === "withdrawn"
          ? [`${teen}’s parent or guardian took their permission back`, `${teen} has been taken out of their tribe. Please reach out to ${teen} and their family with care.`]
          : [`${teen}’s parent or guardian said no`, `${teen} cannot join a tribe unless that changes. Please check in with ${teen} gently.`];
    return { subject, greeting: `Hi ${c.first},`, paragraphs: [body], cta: { label: "Open the teen requests", url: c.link("/care/teens") } };
  },
  sms: (p, c) => {
    const teen = first(p, "teen_first", "A young person");
    return smsLine(
      str(p.what) === "approved"
        ? `${teen}'s parent or guardian said yes. Please phone them to confirm.`
        : str(p.what) === "withdrawn"
          ? `${teen}'s parent or guardian took their permission back. ${teen} has left their tribe.`
          : `${teen}'s parent or guardian said no.`,
      c.link("/care/teens"),
    );
  },
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, {{2}} The teen requests: {{3}}",
    example: ["Dayo", "Ada's parent or guardian said yes. Please phone them to confirm.", "https://unitedtribes.example/care/teens"],
    vars: [
      flat(c.first),
      flat(
        str(p.what) === "approved"
          ? `${first(p, "teen_first", "A young person")}'s parent or guardian said yes. Please phone them to confirm.`
          : str(p.what) === "withdrawn"
            ? `${first(p, "teen_first", "A young person")}'s parent or guardian took their permission back.`
            : `${first(p, "teen_first", "A young person")}'s parent or guardian said no.`,
      ),
      flat(c.link("/care/teens")),
    ],
  }),
};

// ---------------------------------------------------------------------------

/**
 * Meta does not approve a WhatsApp template that ends with a variable, and most of
 * ours end with a link. Every message therefore closes with the same short sign-off,
 * which also tells the reader who it is from.
 */
export const SIGN_OFF = "– United Tribes";
function signed(def: TemplateDef): TemplateDef {
  return {
    ...def,
    whatsapp: (p, c) => {
      const content = def.whatsapp(p, c);
      const body = content.body.trim();
      return /\{\{\d+\}\}[.!?]?$/.test(body) ? { ...content, body: `${body} ${SIGN_OFF}` } : content;
    },
  };
}

export const TEMPLATES: Record<string, TemplateDef> = Object.fromEntries(
  [
    welcome, seasonStartsSoon, weekStart, triadPrompt, meetingReminder, meetingRecap, fridayCheckin, memberMissedTwo, seasonComplete,
    newMember, welcomeCallOverdue, leaderPrep, leaderMeetingReminder, leaderLogLink, leaderLogReminder, weeklyReport,
    leaderMissedOne, leaderMissedTwo, birthdayTomorrow, birthdayToday, testimonyWaiting,
    coachDigest, coachLogMissing, coachMissedThree, coachLowPulse, coachWelcomeOverdue,
    careUrgent, careTask, careTaskReminder, careTaskOverdue, coachHelp, celebrationPrompt,
    applicationReceived, applicationInterviewInvited, applicationInterviewBooked, applicationApproved, applicationApprovedOptional, applicationApprovedDeclaration, applicationApprovedOpen, applicationNotApproved,
    leaderCheckConsent, leaderCheckStrengthen, leaderCheckClear, leaderCheckClearOpen, leaderCheckClearOptional,
    signinPaused, signinStopAlert, leaderOffer,
    refereeRequest, refereeCode, refereeReverify, reportReady,
    swapRequested, swapOffered, swapDeclined, swapMoved, guardianRequest, guardianUpdate,
    ...OUTREACH_TEMPLATES,
    ...NOTICE_TEMPLATES,
    ...PLACEMENT_TEMPLATES,
    ...PLACED_SEQ_TEMPLATES,
    ...INVITATION_TEMPLATES,
    ...LEADER_WELCOME_TEMPLATES,
    ...DETAILS_TEMPLATES,
    ...WHATSAPP_TEMPLATES,
    ...REMOVAL_TEMPLATES,
    ...REACH_TEMPLATES,
    ...REACH_SERIES_TEMPLATES,
    ...LEADER_CARD_TEMPLATES,
  ].map((t) => [t.key, signed(t)]),
);

/** Adds template definitions from other modules (reports, guardian consent) without a circular import. */
export function registerTemplates(defs: TemplateDef[]) {
  for (const def of defs) TEMPLATES[def.key] = signed(def);
}

export type { Context };
export { dayName };

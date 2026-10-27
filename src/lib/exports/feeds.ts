import { createHash } from "node:crypto";
import { writeZip } from "@/lib/leaders/referee/sheet/zip";
import { csvColumns, toCsv } from "./csv";
import { cleanDate, cleanDateTime } from "./guard";
import { col, lagosDay, type Cell, type Column, type Table } from "./model";
import { FEED_TABLES, type FeedTable, type TableRows } from "./types";

/**
 * The seven coded tables other reporting tools read, and the Open Data Pack that gathers them. Every column says what it is, so the
 * data dictionary in the pack and the table schema a tool sees are the same words. None of them holds a name, a phone number, an email
 * address or anything a person wrote: a member is a code that cannot be turned back into a name, and members under 18 are not listed.
 */

const id = (key: string, label: string, about: string) => col.text(key, label, about, 38);

export const FEED_SCHEMA: Record<FeedTable, { title: string; about: string; columns: Column[] }> = {
  members: {
    title: "Members",
    about: "One row for each adult member and season. A member is a code, never a name. Members under 18 are not listed (the pack's manifest says how many were left out).",
    columns: [
      id("season_id", "season_id", "The season's code."),
      col.text("season", "season", "The season's name."),
      id("member_key", "member_key", "A code for the member that is the same in every table and cannot be turned back into a name."),
      id("tribe_id", "tribe_id", "The tribe's code."),
      col.text("community", "community", "The community the member chose."),
      col.text("track", "track", "The track the member chose."),
      col.text("season_goal", "season_goal", "The goal the member chose for the season."),
      col.text("zone", "zone", "The part of Lagos the member gave."),
      col.int("degree_of_compatibility", "degree_of_compatibility", "How well the member matched their tribe, from 0 to 100."),
      col.int("chosen_rank", "chosen_rank", "Which of the member's choices they were placed in (1 is the first)."),
      col.int("meetings_attended", "meetings_attended", "Meetings the member came to this season."),
      col.int("meetings_attended_last_3", "meetings_attended_last_3", "Meetings the member came to of the last three held."),
      col.int("belonging_latest", "belonging_latest", "The member's latest answer to 'I belong here', from 1 to 5."),
      col.int("success_week_1", "success_week_1", "The Success Picture score in the first week, from 3 to 15."),
      col.int("success_latest", "success_latest", "The latest Success Picture score, from 3 to 15."),
      col.int("success_gain", "success_gain", "The latest score minus the first."),
      col.int("steps_set", "steps_set", "Weekly steps the member set."),
      col.int("steps_done", "steps_done", "Weekly steps the member says they did."),
      col.int("steps_checked", "steps_checked", "Weekly steps that were looked at the week after."),
      col.yesno("thriving", "thriving", "True when the member came to enough meetings and feels at home."),
      col.date("joined_on", "joined_on", "The day the member joined the tribe."),
      col.decimal("form_minutes", "form_minutes", "Minutes the member took to fill in the form."),
      col.int("assisted_fields", "assisted_fields", "Form answers where the member used the assistant's suggestion."),
    ],
  },
  tribes: {
    title: "Tribes",
    about: "One row for each tribe and season, with its numbers. No leader's name: whether the tribe has a coach and a certified leader is shown instead.",
    columns: [
      id("season_id", "season_id", "The season's code."),
      col.text("season", "season", "The season's name."),
      id("tribe_id", "tribe_id", "The tribe's code."),
      col.text("community", "community", "The tribe's community."),
      col.text("track", "track", "The tribe's track."),
      col.text("season_goal", "season_goal", "The tribe's goal for the season."),
      col.int("capacity", "capacity", "Seats in the tribe."),
      col.int("members", "members", "Members in the tribe."),
      col.int("meetings_held", "meetings_held", "Meetings the tribe has held."),
      col.int("present", "present", "Places filled at those meetings, added up."),
      col.int("possible", "possible", "Places there could have been at those meetings."),
      col.percent("attendance_rate", "attendance_rate", "present divided by possible (0 to 1)."),
      col.int("thriving", "thriving", "Members who are thriving."),
      col.percent("thriving_rate", "thriving_rate", "Thriving members divided by members (0 to 1)."),
      col.int("gain_answers", "gain_answers", "Members with a Success Picture score at the start and now."),
      col.decimal("gain_avg", "gain_avg", "The average rise in the Success Picture score."),
      col.text("verdict", "verdict", "Where the tribe stands: effective, on_course, close, at_risk, too_early or before."),
      col.yesno("has_coach", "has_coach", "True when a coach looks after the tribe."),
      col.yesno("leader_certified", "leader_certified", "True when the leader has finished the training."),
      col.yesno("assistant_certified", "assistant_certified", "True when the assistant has finished the training."),
    ],
  },
  weekly: {
    title: "Weekly",
    about: "One row for each tribe and week of a season: whether the tribe met, how many came and how many steps were set and done.",
    columns: [
      id("season_id", "season_id", "The season's code."),
      col.text("season", "season", "The season's name."),
      id("tribe_id", "tribe_id", "The tribe's code."),
      col.int("week", "week", "The week of the season (1 is the first)."),
      col.date("meeting_date", "meeting_date", "The day the tribe met."),
      col.yesno("held", "held", "True when the meeting was held."),
      col.int("present", "present", "Members who came."),
      col.int("marked", "marked", "Members whose attendance was marked."),
      col.int("steps_set", "steps_set", "Steps set that week."),
      col.int("steps_done", "steps_done", "Steps done that week."),
    ],
  },
  care_weekly: {
    title: "Care by week",
    about: "Care tasks opened and closed each week, by kind. Counts only: never who, or what was said.",
    columns: [
      col.date("week_start", "week_start", "The Monday the week starts."),
      col.text("kind", "kind", "The kind of care task."),
      col.int("opened", "opened", "Tasks opened that week."),
      col.int("closed", "closed", "Tasks closed that week."),
    ],
  },
  messages_daily: {
    title: "Messages by day",
    about: "Messages sent each day by kind, channel and outcome. Counts only: never the wording or who it went to.",
    columns: [
      col.date("day", "day", "The day the messages were counted."),
      col.text("template", "template", "The kind of message."),
      col.text("channel", "channel", "How it was sent: email, whatsapp or sms."),
      col.text("status", "status", "What happened to it."),
      col.int("messages", "messages", "How many messages of this kind, channel and outcome that day."),
    ],
  },
  ai_fields: {
    title: "Assistant suggestions",
    about: "For each form field, how often the assistant's suggestion was shown and how often it was kept.",
    columns: [
      id("season_id", "season_id", "The season's code."),
      col.text("season", "season", "The season's name."),
      col.text("field", "field", "The form field."),
      col.int("shown", "shown", "Times a suggestion was shown."),
      col.int("kept", "kept", "Times it was kept."),
      col.percent("keep_rate", "keep_rate", "kept divided by shown (0 to 1)."),
    ],
  },
  kpi_daily: {
    title: "Daily figures",
    about: "The programme's headline figures as they stood each day, for drawing a trend.",
    columns: [
      id("season_id", "season_id", "The season's code."),
      col.text("season", "season", "The season's name."),
      col.date("taken_on", "taken_on", "The day the figures were taken."),
      col.int("week", "week", "The week of the season."),
      col.int("members", "members", "Members that day."),
      col.percent("attendance_rate", "attendance_rate", "Share of places filled (0 to 1)."),
      col.percent("retention_rate", "retention_rate", "Share of the first week's members still coming (0 to 1)."),
      col.percent("thriving_rate", "thriving_rate", "Share of members thriving (0 to 1)."),
      col.percent("word_habit_rate", "word_habit_rate", "Share of members in the Word most days (0 to 1)."),
      col.percent("goal_gain_share", "goal_gain_share", "Share of members gaining on their goal (0 to 1)."),
      col.percent("care_resolved_rate", "care_resolved_rate", "Share of care tasks done in time (0 to 1)."),
      col.decimal("assistants_per_tribe", "assistants_per_tribe", "Certified assistants for each tribe."),
      col.decimal("median_days_to_first_meeting", "median_days_to_first_meeting", "The middle number of days from the form to a first meeting."),
      col.decimal("median_form_minutes", "median_form_minutes", "The middle number of minutes on the form."),
      col.percent("form_completion_rate", "form_completion_rate", "Share of people who finished the form (0 to 1)."),
      col.percent("ai_keep_lowest_field_rate", "ai_keep_lowest_field_rate", "The keep rate of the form field with the lowest rate (0 to 1)."),
      col.int("open_care_tasks", "open_care_tasks", "Care tasks open that day."),
    ],
  },
};

export const isFeedTable = (v: unknown): v is FeedTable => typeof v === "string" && (FEED_TABLES as string[]).includes(v);

/** The rows the database gave for one table, as a typed table. Columns it did not give are left empty; columns it gave that are not in the schema are dropped. */
export function feedTable(name: FeedTable, rows: Record<string, unknown>[]): Table {
  const spec = FEED_SCHEMA[name];
  return {
    id: name,
    sheet: spec.title,
    title: spec.title,
    caption: spec.about,
    columns: spec.columns,
    rows: rows.map((r) => spec.columns.map((c): Cell => cell(r[c.key], c.type))),
  };
}

function cell(v: unknown, type: Column["type"]): Cell {
  if (v === null || v === undefined) return null;
  if (type === "date") return cleanDate(v);
  if (type === "datetime") return cleanDateTime(v);
  if (type === "int" || type === "decimal" || type === "percent") {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (type === "yesno") return v === true || v === "true" ? true : v === false || v === "false" ? false : null;
  return typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : null;
}

/** One table as a CSV, for a standing feed link. */
export function feedCsv(data: TableRows): string {
  return toCsv(feedTable(data.table, data.rows));
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

export const OPEN_DATA_RULES = [
  "No names, phone numbers, email addresses or anything a person wrote. A member is a code that cannot be turned back into a name.",
  "Members under 18 are not listed in any table; the count of those left out is in this file.",
  "These are the church's figures for the church's own reporting. Do not combine them with other data to work out who a member is.",
  "The figures are a copy made on the date below and are not updated. Make a new pack, or use a standing link, for newer ones.",
];

/** The Open Data Pack: one CSV for each table, a data dictionary, a read-me and a manifest with a SHA-256 checksum of every file. */
export function openDataPack(tables: TableRows[], made: Date, exportId: string): Buffer {
  const files: { name: string; data: Buffer }[] = [];
  const manifest: unknown[] = [];
  let young = 0;
  let refreshed: string | null = null;
  const dictionary: string[][] = [["table", "column", "type", "meaning"]];
  for (const data of tables) {
    const t = feedTable(data.table, data.rows);
    const csv = Buffer.from(toCsv(t), "utf8");
    files.push({ name: `${t.id}.csv`, data: csv });
    if (data.table === "members") young = data.young_not_listed;
    refreshed = data.refreshed_at ?? refreshed;
    const cols = csvColumns(t).map(({ column }) => column);
    for (const c of cols) dictionary.push([t.id, c.key, c.type, c.about]);
    manifest.push({ table: t.id, file: `${t.id}.csv`, rows: t.rows.length, bytes: csv.length, sha256: sha256(csv), about: FEED_SCHEMA[data.table].about, columns: cols.map((c) => ({ name: c.key, type: c.type, about: c.about })) });
  }
  const dictCsv = Buffer.from(`\uFEFF${dictionary.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\r\n")}\r\n`, "utf8");
  files.push({ name: "dictionary.csv", data: dictCsv });
  manifest.push({ table: null, file: "dictionary.csv", rows: dictionary.length - 1, bytes: dictCsv.length, sha256: sha256(dictCsv), about: "Every column of every table: its name, its kind of value and what it means." });
  const readme = [
    "UNITED TRIBES: OPEN DATA PACK",
    "",
    `Made on ${lagosDay(made)} (Lagos). File ${exportId}.`,
    refreshed ? `The figures were last refreshed at ${refreshed}.` : "",
    "",
    "What is in this pack",
    ...tables.map((d) => `  ${d.table}.csv  ${FEED_SCHEMA[d.table].about}`),
    "  dictionary.csv  Every column of every table: its name, its kind of value and what it means.",
    "  manifest.json  The list of files with the number of rows and a SHA-256 checksum of each, so you can check nothing changed on the way.",
    "",
    "Rules",
    ...OPEN_DATA_RULES.map((r) => `  - ${r}`),
    "",
    "Reading the files",
    "  UTF-8 with a byte-order mark, comma separated, lines end CR LF, dates are year-month-day, shares are numbers from 0 to 1, yes/no columns are true or false.",
    "  Free text is never in these files.",
    "",
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\r\n");
  files.push({ name: "README.txt", data: Buffer.from(readme, "utf8") });
  files.push({
    name: "manifest.json",
    data: Buffer.from(
      `${JSON.stringify({ pack: "open_data_pack", file: exportId, made_on: lagosDay(made), refreshed_at: refreshed, members_under_18_not_listed: young, rules: OPEN_DATA_RULES, files: manifest }, null, 2)}\n`,
      "utf8",
    ),
  });
  return writeZip(files);
}

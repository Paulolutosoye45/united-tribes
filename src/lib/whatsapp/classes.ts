/**
 * The three classes every WhatsApp message belongs to (WhatsApp mode). They decide what Saver does:
 *   A  must reach        a time-sensitive answer, an urgent care message, a private code. Stays on WhatsApp in Saver.
 *   B  weekly rhythm     the Monday to Friday messages and the leaders' and coaches' weekly prompts. Goes by email in Saver.
 *   C  email is enough   applications, referee and guardian notes, reports. Goes by email in Saver.
 * Free mode ignores the class: nothing goes through Meta at all.
 *
 * This is the starting table, and the same list is seeded into the database (supabase/migrations/20270105000100_whatsapp_mode.sql). The director can
 * change a class on the WhatsApp mode page; a test makes sure that every message that can go by WhatsApp has one here.
 */
export type MessageClass = "A" | "B" | "C";

export const CLASS_WORDS: Record<MessageClass, { name: string; short: string; saver: string }> = {
  A: { name: "Must reach", short: "A", saver: "stays on WhatsApp" },
  B: { name: "Weekly rhythm", short: "B", saver: "goes by email" },
  C: { name: "Email is enough", short: "C", saver: "goes by email" },
};

export const DEFAULT_CLASSES: Record<string, MessageClass> = {
  swap_offered: "A",
  care_urgent: "A",
  care_task_overdue: "A",
  details_check_request: "A",
  details_check_reminder: "A",
  referee_code: "A",
  guardian_request: "A",
  whatsapp_test: "A",
  welcome: "B",
  season_starts_soon: "B",
  week_start: "B",
  triad_prompt: "B",
  meeting_reminder: "B",
  meeting_recap: "B",
  friday_checkin: "B",
  member_missed_two: "B",
  season_complete: "B",
  swap_declined: "B",
  new_member: "B",
  welcome_call_overdue: "B",
  leader_prep: "B",
  leader_meeting_reminder: "B",
  leader_log_link: "B",
  leader_log_reminder: "B",
  weekly_report: "B",
  leader_missed_one: "B",
  leader_missed_two: "B",
  birthday_tomorrow: "B",
  birthday_today: "B",
  testimony_waiting: "B",
  care_task: "B",
  care_task_reminder: "B",
  celebration_prompt: "B",
  swap_moved: "B",
  coach_digest: "B",
  coach_log_missing: "B",
  coach_missed_three: "B",
  coach_low_pulse: "B",
  coach_welcome_overdue: "B",
  coach_help: "B",
  swap_requested: "B",
  application_received: "C",
  application_interview_invited: "C",
  application_interview_booked: "C",
  application_approved: "C",
  application_approved_optional: "C",
  application_approved_declaration: "C",
  application_approved_open: "C",
  application_not_approved: "C",
  leader_check_consent: "C",
  leader_check_strengthen: "C",
  leader_check_clear: "C",
  leader_check_clear_open: "C",
  leader_check_clear_optional: "C",
  referee_request: "C",
  referee_reverify: "C",
  report_ready: "C",
  guardian_update: "C",
};

/** A message the table does not know stays on WhatsApp, exactly as it does today (the database does the same). */
export function classOf(template: string, table: Record<string, string> = DEFAULT_CLASSES): MessageClass {
  const c = table[template];
  return c === "B" || c === "C" ? c : "A";
}

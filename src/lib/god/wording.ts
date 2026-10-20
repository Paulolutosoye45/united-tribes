import { ROLES, ROLE_LABELS, type Role } from "@/lib/auth/roles";

// Plain words for what the platform records. An action the list does not know is shown as it is written, so a new one
// never disappears from the owner's view.

const ACTIONS: Record<string, string> = {
  "person.created": "signed in for the first time",
  "person.erased": "was erased at their request",
  "role.granted": "was given a role",
  "role.revoked": "had a role removed",
  "invitation.created": "invited someone to a role",
  "invitation.revoked": "took back an invitation",
  "match.run": "ran the matching",
  "match.chosen": "chose a tribe",
  "match.released": "left a tribe",
  "tribe.started": "started a tribe card",
  "tribe.submitted": "sent a tribe card for review",
  "tribe.approved": "approved a tribe",
  "tribe.changes_requested": "asked for changes to a tribe card",
  "tribe.meeting_saved": "saved the meeting details",
  "tribe.onboarding_saved": "saved a tribe’s welcome",
  "tribe.log": "logged a meeting",
  "tribe.assistant_paired": "paired an assistant leader",
  "tribe.assistant_unpaired": "unpaired an assistant leader",
  "tribe.coach_assigned": "assigned a coach",
  "tribe.picture_refined": "refined a tribe’s picture of success",
  "leader.applied": "applied to lead",
  "leader.decided": "decided a leader application",
  "leader.reviewed": "scored a leader application",
  "leader.invited": "invited an applicant to interview",
  "leader.interview_booked": "booked an interview",
  "leader.reference_received": "received a reference",
  "leader.concern_cleared": "cleared a concern",
  "leader.appointed": "appointed a leader",
  "leader.stepped_down": "stepped a leader down from an appointment",
  "leader.offer_sent": "offered a leader a tribe where members are waiting",
  "leader.offer_withdrawn": "withdrew an offer to lead",
  "leader.offer_accepted": "accepted an offer to lead a tribe",
  "leader.offer_declined": "declined an offer to lead a tribe",
  "leader_fit.chosen": "chose a tribe on the application",
  "leader_fit.model_saved": "saved a new version of the fit model",
  "leader_fit.model_approved": "approved the fit model",
  "leader_fit.quiet_run": "looked at the leaders we already have",
  "card_template.created": "added a ready-made tribe card",
  "card_template.saved": "changed a ready-made tribe card",
  "card_template.signed_off": "signed off a ready-made tribe card",
  "card_template.retired": "retired a ready-made tribe card",
  "academy.module_passed": "passed a training module",
  "academy.certified": "was certified",
  "academy.declaration_signed": "signed the safeguarding declaration",
  "academy.session_booked": "booked a workshop",
  "academy.attendance_marked": "marked workshop attendance",
  "academy.practice_recorded": "recorded a practice session",
  "care.call": "made a care call",
  "care.concern": "raised a concern",
  "care.task_opened": "opened a care task",
  "care.task_reassigned": "reassigned a care task",
  "centre.switched": "switched centre",
  "centre.created": "opened a centre",
  "champion.assigned": "appointed a community champion",
  "champion.removed": "removed a community champion",
  "checkin.by_reply": "checked in by replying",
  "contact.saved": "saved how to be reached",
  "contact.opt_out": "opted out of messages",
  "erasure.requested": "asked for their account to be deleted",
  "erasure.recorded": "recorded a deletion request",
  "erasure.declined": "answered a deletion request with not yet",
  "erasure.withdrawn": "took back a deletion request",
  "goal.adopted": "adopted a goal",
  "goal.created": "created a goal",
  "goal.saved": "saved a goal",
  "guide.saved": "saved a weekly guide",
  "guide.reviewed": "reviewed a weekly guide",
  "kpi.target_set": "set a target",
  "kpi.target_reset": "reset a target",
  "message.retried": "retried a message",
  "multiply.planned": "planned a multiplication",
  "photo.saved": "added a photo",
  "photo.removed": "removed a photo",
  "prayer.answered": "marked a prayer answered",
  "report.generated": "generated a report",
  "retention.ran": "ran the daily clean-up",
  "season.created": "created a season",
  "season.saved": "changed a season",
  "season.status": "moved a season on",
  "settings.saved": "changed the church’s settings",
  "swap.requested": "asked to change tribe",
  "swap.moved": "moved someone to another tribe",
  "testimony.submitted": "shared a testimony",
  "testimony.forwarded": "forwarded a testimony",
  "community.saved": "changed a community",
  "worker_token.created": "made a sending token",
  "worker_token.revoked": "revoked a sending token",
  "bi.refreshed": "refreshed the reporting copy",
  // The owner's own looks at the activity dashboard, shown in the audit trail as "You".
  "activity.viewed": "looked at a tab of the activity dashboard",
  "activity.exported": "exported the audit trail",
  "activity.activity_setting": "changed an activity setting",
};

export function describeAction(action: string): string {
  return ACTIONS[action] ?? action.replace(/[._]/g, " ");
}

/** The area an action belongs to, for the colour dot and the filter. */
export function areaOf(action: string): "people" | "tribes" | "leaders" | "care" | "office" | "privacy" {
  const head = action.split(".")[0];
  if (["person", "role", "invitation", "contact", "photo", "checkin"].includes(head)) return "people";
  if (["tribe", "match", "swap", "multiply", "prayer", "testimony", "goal"].includes(head)) return "tribes";
  if (["leader", "leader_fit", "card_template", "academy", "champion"].includes(head)) return "leaders";
  if (["care"].includes(head)) return "care";
  if (["erasure", "retention", "guardian"].includes(head)) return "privacy";
  return "office";
}

const KINDS: Record<string, string> = {
  unlock: "You unlocked the console",
  lock: "You locked the console",
  wrong: "A wrong passphrase",
  refused: "An attempt was refused while locked",
  probe: "Someone else tried the unlock",
  phrase_changed: "You changed your passphrase",
  owner_set: "The owner account was set",
  owner_removed: "The owner account was removed",
  action: "You changed something",
  viewed: "You looked at a tab of the activity dashboard",
  exported: "You exported the audit trail",
  activity_setting: "You changed an activity setting",
  looked: "You looked at part of the console",
};

export function describeKind(kind: string): string {
  return KINDS[kind] ?? kind.replace(/_/g, " ");
}

const ACTIVITY_TABS: Record<string, string> = {
  pulse: "Pulse",
  funnels: "Funnels",
  stakeholders: "Stakeholders",
  integrity: "Quality and integrity",
  messages: "Messages and sign-in",
  audit: "Audit trail",
  settings: "Settings",
};

const ACTIVITY_SETTINGS: Record<string, string> = {
  recording: "recording",
  retention: "how long detail is kept",
  member_wait_days: "the flag for members waiting for a tribe",
  application_held_hours: "the flag for held leader applications",
  referee_unverified_days: "the flag for unverified referees",
  failed_messages_7d: "the flag for failed messages",
  care_overdue_days: "the flag for overdue care tasks",
  signin_fail_pct: "the flag for failing sign-in codes",
  quiet_days: "the flag for quiet members",
};

/** The owner's record line for a look at, an export of, or a change to the activity dashboard; null for any other kind. */
export function activityLine(kind: string, action: string | null, detail: Record<string, unknown> = {}): string | null {
  if (kind === "viewed") return `You looked at the ${ACTIVITY_TABS[action ?? ""] ?? "activity"} tab of the activity dashboard`;
  if (kind === "exported") return `You exported the ${ACTIVITY_TABS[action ?? ""]?.toLowerCase() ?? "activity"} as a spreadsheet file`;
  if (kind === "activity_setting") {
    const what = ACTIVITY_SETTINGS[action ?? ""] ?? "an activity setting";
    const change = detail.from !== undefined && detail.to !== undefined ? `, from ${String(detail.from)} to ${String(detail.to)}` : "";
    return `You changed ${what}${change}`;
  }
  return null;
}

/** The owner’s record line for a look at the desks or the conversations; null for any other kind. */
export function lookedLine(kind: string, action: string | null, ref: string | null): string | null {
  if (kind !== "looked") return null;
  if (action === "desks") return "You looked at every desk";
  if (action === "desk") {
    const label = ref && (ROLES as readonly string[]).includes(ref) ? ROLE_LABELS[ref as Role] : null;
    return label ? `You looked at the ${label.toLowerCase()} desk` : "You looked at a desk";
  }
  if (action === "conversations") return "You looked at the messages the platform has sent";
  if (action === "person_conversation") return "You read the messages sent to one person";
  if (action === "chat_opens") return "You looked at the chats staff opened";
  return "You looked at part of the console";
}

/** Colour for the kind: what needs the owner's eye is flagged. */
export function kindTone(kind: string): "calm" | "watch" | "alert" {
  if (kind === "probe" || kind === "refused") return "alert";
  if (kind === "wrong") return "watch";
  return "calm";
}

export function roleWords(roles: readonly string[] | null | undefined): string {
  return (roles ?? []).map((r) => r.replace(/_/g, " ")).join(", ");
}

/** The time now, in milliseconds. A function of its own so a page reads the clock once, at the top, and passes it down. */
export function clock(): number {
  return Date.now();
}

/** "3 minutes ago" for a moment, in words; falls back to the date for anything older than a week. */
export function ago(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  if (days < 8) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return "";
}

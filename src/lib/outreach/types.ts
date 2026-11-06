/** What the office screens read. The database builds each of these; see supabase/migrations/20261213000100_reminders_broadcasts.sql. */

export type AudienceSpec = {
  kind: string;
  community?: string;
  idle_days?: number;
  no_fit?: "include" | "exclude" | "only";
  stages?: string[];
  roles?: string[];
  /** Contact gaps: who is meant (no number saved, no yes to WhatsApp, or either), and one tribe if narrowed. */
  cause?: "no_number" | "no_yes" | "either";
  tribe?: string;
  /** The placed-member nudge: everyone waiting, or only those with no number or no WhatsApp yes; and how long since the placement email went. */
  need?: "all" | "gap";
  waited_hours?: number;
};

export type AudiencePreview = {
  spec: AudienceSpec;
  total: number;
  will_send: number;
  skipped: Record<string, number>;
  needs_approval: boolean;
};

export type AudienceSample = { found: boolean; of?: number; vars?: Record<string, string> };

export type BroadcastStatus = "draft" | "awaiting_approval" | "scheduled" | "sending" | "paused" | "sent" | "cancelled" | "rejected";

export type BroadcastRow = {
  id: string;
  title: string;
  subject: string;
  audience_label: string;
  status: BroadcastStatus;
  needs_approval: boolean;
  scheduled_for: string | null;
  started_at: string | null;
  finished_at: string | null;
  snapshot_count: number | null;
  recipient_count: number | null;
  created_by: string | null;
  created_by_me: boolean;
  created_at: string;
  sent: number;
  queued: number;
};

export type Broadcast = {
  id: string;
  title: string;
  audience: AudienceSpec;
  audience_label: string;
  subject: string;
  paragraphs: string[];
  button_label: string | null;
  button_target: string | null;
  status: BroadcastStatus;
  needs_approval: boolean;
  reject_note: string | null;
  scheduled_for: string | null;
  snapshot_count: number | null;
  recipient_count: number | null;
  created_by_me: boolean;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

export type BroadcastResults = {
  frozen: number;
  waiting: number;
  sent: number;
  delivered: number;
  bounced: number;
  left_out: Record<string, number>;
  unsubscribed: number;
  tapped: number;
  final_at: string | null;
  /** The placed nudge only: of those it was for, how many have said yes since, and how many have agreed to WhatsApp since. */
  placed?: { asked: number; said_yes: number; agreed: number };
};

export type ApprovalRow = {
  id: string;
  title: string;
  subject: string;
  paragraphs: string[];
  button_label: string | null;
  button_target: string | null;
  audience_label: string;
  count: number;
  scheduled_for: string | null;
  created_by: string | null;
  mine: boolean;
  created_at: string;
  sample: Record<string, string> | null;
};

export type SavedAudience = { id: string; name: string; spec: AudienceSpec; label: string };

export type JourneyEmail = {
  id: string;
  step: number;
  tone: string;
  subject: string;
  paragraphs: string[];
  button_label: string | null;
  actions: string[];
  version: number;
  pending: { subject: string; paragraphs: string[]; button_label: string | null; edited_by_name: string | null; edited_at: string } | null;
  approved_at: string | null;
  approved_by: string | null;
  sent: number;
  acted_7d: number;
  unsub: number;
};

export type Tally = { people: number; acted: number };

export type JourneyOverview = {
  key: string;
  title: string;
  mode: "off" | "rehearsal" | "on";
  day_offsets: number[];
  paused_reason: string | null;
  paused_at: string | null;
  position: number;
  active: number;
  entered_30d: number;
  acted_30d: number;
  unsub_30d: number;
  complaints_30d: number;
  not_season_30d: number;
  reasons: Record<string, number>;
  helped: number;
  rehearsal_would_send: number;
  treated: Tally;
  holdout: Tally;
  emails: JourneyEmail[];
};

export type ReminderSettings = {
  master_on: boolean;
  holdout_pct: number;
  applications_close_on: string | null;
  joining_closes_days: number;
  cap_gap_days: number;
  cap_reminders_week: number;
  cap_nonessential_week: number;
  reminder_start_hour: number;
  reminder_end_hour: number;
  sunday_start_hour: number;
  bulk_start_hour: number;
  bulk_end_hour: number;
  bulk_per_minute: number;
  approval_threshold: number;
  church_name: string;
  church_address: string;
};

export type RecentSend = { at: string; kind: "sent" | "rehearsal" | "skipped"; step: number; journey: string; reason: string | null; who: string | null };

export type RemindersOverview = {
  settings: ReminderSettings;
  can_change: boolean;
  can_edit_words: boolean;
  can_approve_words: boolean;
  can_see_people: boolean;
  today: { sent: number; rehearsed: number; skipped: number };
  asks_open: number;
  journeys: JourneyOverview[];
  recent: RecentSend[];
};

export type JourneyPerson = { person_id: string; name: string; step_done: number; started_at: string; rehearsal: boolean; holdout: boolean; next_due: string | null; can_chat: boolean };

export type AskRow = { id: string; person_id: string; name: string; kind: string; journey: string | null; status: "open" | "closed"; created_at: string; handled_by: string | null; handled_at: string | null; can_chat: boolean };

export type VersionRow = { version: number; subject: string; paragraphs: string[]; button_label: string | null; edited_by: string | null; approved_by: string | null; at: string };

export type EmailSwitches = { reminders: boolean; announcements: boolean; tribe: boolean };

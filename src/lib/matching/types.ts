/** What `my_match()` and `tribe_roster()` return. The database is the source of truth. */

export type DegreeLabel = "excellent" | "strong" | "good";

export interface TribeCardForMember {
  id: string;
  name: string;
  community: string | null;
  track: string | null;
  goal: string | null;
  tribe_type: "mixed" | "women" | "men";
  story: string | null;
  leader_first_name: string;
  /** Set when the leader has added a portrait. Fetch it from /api/photo/<person id>. */
  leader_photo_id: string | null;
  meeting_day: number;
  meeting_time: string;
  duration_minutes: number;
  mode: "online" | "in_person";
  zone: string;
  place_note: string | null;
  capacity: number;
  seats_left: number;
  open: boolean;
  god: string;
  others: string;
  life: string;
  season_starts_on: string;
}

export interface ShownTribe {
  rank: 1 | 2 | 3;
  degree: number;
  label: DegreeLabel;
  reasons: string[];
  chosen: boolean;
  tribe: TribeCardForMember;
}

export interface Placement {
  tribe: TribeCardForMember;
  rank: number | null;
  degree: number | null;
  label: DegreeLabel | null;
  joined_at: string;
  agreed_at: string;
  covenant: { name: string; god: string; others: string; life: string };
  first_meeting_by: string;
  first_meeting_on: string | null;
  group_url: string | null;
  called: boolean;
  assistant_first_name: string | null;
  can_release: boolean;
  season_name: string;
  season_starts_on: string;
}

export interface MyMatch {
  profile: boolean;
  season: { name: string; starts_on: string } | null;
  ran: boolean;
  ran_at: string | null;
  model: string | null;
  candidates: number | null;
  tribes: ShownTribe[];
  /** Fewer than three tribes fit well enough, so a Starter Tribe is offered. */
  short: boolean;
  on_starter_list: boolean;
  placement: Placement | null;
}

export interface RosterMember {
  person_id: string;
  name: string;
  first_name: string;
  whatsapp: string | null;
  joined_at: string;
  first_meeting_by: string;
  called: boolean;
  called_at: string | null;
  /** What they chose to be: encourager, host and so on. */
  roles: string[];
  /** Their Success Picture sentence for the season. */
  success: string | null;
  /** The private note to the leader, opened on the server. Only leaders and assistants ever get one. */
  note: string | null;
  /** A note exists but could not be opened (the key is missing or has changed). */
  note_locked: boolean;
  /** Set when the church placed them: waiting for their yes, or said yes. */
  placement?: "pending" | "confirmed";
  /** For such a member: whether their email and WhatsApp number are open to the leader, or when they will be. */
  contact?: "open" | "withheld" | "holding" | "waiting" | "not_reached" | "unanswered";
  contact_opens_at?: string | null;
  /** They asked that their WhatsApp number is not shared. They have the leader's details and will reach out. */
  withheld?: boolean;
}

/** What the database returns for a member: the note is still sealed. It never leaves the server in this form. */
export type RawRosterMember = Omit<RosterMember, "note" | "note_locked"> & { note_enc: string | null };

export interface Roster {
  tribe: {
    id: string;
    name: string;
    status: string;
    capacity: number;
    group_url: string | null;
    first_meeting_on: string | null;
    meeting_day: number;
    meeting_time: string;
    season_starts_on: string;
    can_edit: boolean;
  };
  members: RosterMember[];
}

export interface MatchStats {
  profiled: number;
  placed: number;
  waiting: number;
  tribes_open: number;
  seats_total: number;
  seats_taken: number;
  ran: number;
  by_rank: { first: number; second: number; third: number };
  bands: { excellent: number; strong: number; good: number };
  average_degree: number | null;
  starter_list: number;
  unmet: number;
  gaps: { track: string | null; community: string | null; goal: string | null; kind: string; members: number }[];
}

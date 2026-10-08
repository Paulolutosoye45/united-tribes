/** What `my_match()` and `circle_roster()` return. The database is the source of truth. */

export type DegreeLabel = "excellent" | "strong" | "good";

export interface CircleCardForMember {
  id: string;
  name: string;
  tribe: string | null;
  track: string | null;
  goal: string | null;
  circle_type: "mixed" | "women" | "men";
  story: string | null;
  leader_first_name: string;
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

export interface ShownCircle {
  rank: 1 | 2 | 3;
  degree: number;
  label: DegreeLabel;
  reasons: string[];
  chosen: boolean;
  circle: CircleCardForMember;
}

export interface Placement {
  circle: CircleCardForMember;
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
  circles: ShownCircle[];
  /** Fewer than three circles fit well enough, so a Starter Circle is offered. */
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
}

export interface Roster {
  circle: {
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
  circles_open: number;
  seats_total: number;
  seats_taken: number;
  ran: number;
  by_rank: { first: number; second: number; third: number };
  bands: { excellent: number; strong: number; good: number };
  average_degree: number | null;
  starter_list: number;
  unmet: number;
  gaps: { track: string | null; tribe: string | null; goal: string | null; kind: string; members: number }[];
}

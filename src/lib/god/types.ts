// What the owner's console functions return (supabase/migrations/20261209000100_superadmin.sql).

export type GodOverview = {
  now: string;
  open_until: string | null;
  phrase_changed_at: string | null;
  people: { total: number; today: number; with_profile: number; drafts: number };
  tribes: Record<string, number>;
  seats: number;
  care_open: number;
  erasure_open: number;
  messages: { queued: number; sent_today: number; failed_7d: number; worker_seen: string | null };
  assistant: { calls_24h: number; fallbacks_24h: number };
  activity: { last_hour: number; last_day: number };
  attempts: { wrong_7d: number; probes_7d: number };
};

export type FeedEvent = {
  id: number;
  at: string;
  action: string;
  entity: string | null;
  entity_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_roles: string[] | null;
  subject_name: string | null;
  meta: Record<string, unknown>;
};

export type GodPersonRow = {
  id: string;
  email: string;
  name: string;
  created_at: string;
  roles: string[] | null;
  form: "new" | "started" | "complete";
  tribe: string | null;
  last_seen: string | null;
};

export type GodPeople = { total: number; people: GodPersonRow[] };

export type GodPerson = {
  person: { id: string; email: string; full_name: string | null; preferred_name: string | null; created_at: string; centre: string | null };
  roles: string[];
  consents: { purpose: string; granted: boolean; at: string }[];
  form: { state: "complete"; community: string | null; goal: string | null; age: string | null; track: string | null; zone: string | null; mode: string | null; seconds: number | null } | null;
  draft: { state: "started"; step: string | null; updated_at: string } | null;
  placement: { tribe_id: string; tribe: string; status: string; joined_at: string | null; leader: string | null } | null;
  leads: { id: string; name: string; status: string; members: number }[];
  application: { status: string; submitted_at: string | null } | null;
  attendance: { present: number; absent: number; excused: number };
  messages: { by_status: Record<string, number>; recent: { template: string; channel: string | null; status: string; at: string }[] };
  assistant: { calls: number; fallbacks: number };
  erasure: string | null;
  events: { id: number; at: string; action: string; entity: string | null; entity_id: string | null; by_them: boolean }[];
};

export type GodTribeRow = {
  id: string;
  name: string;
  status: string;
  capacity: number | null;
  leader: string | null;
  assistant: string | null;
  coach: string | null;
  community: string | null;
  season: string | null;
  members: number;
  last_week_held: number | null;
};

export type GodTribe = {
  tribe: { id: string; name: string; status: string; capacity: number | null; zone: string | null; mode: string | null; leader: string | null; leader_id: string | null; assistant: string | null; coach: string | null; community: string | null; season: string | null };
  members: { id: string; name: string; status: string; joined_at: string | null; present: number; missed: number }[];
  weeks: { week: number; held: boolean; energy: number | null; need_coach: boolean | null; highlight: string | null; logged_at: string }[];
  care_open: number;
};

export type GodLogEntry = {
  id: number;
  at: string;
  kind: string;
  action: string | null;
  entity: string | null;
  entity_id: string | null;
  detail: Record<string, unknown>;
};

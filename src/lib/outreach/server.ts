import "server-only";
import { hasAnyRole } from "@/lib/auth/roles";
import type { Session } from "@/lib/auth/session";
import { siteUrl } from "@/lib/messaging/worker";
import { createClient } from "@/lib/supabase/server";
import type { ApprovalRow, AskRow, Broadcast, BroadcastResults, BroadcastRow, EmailSwitches, JourneyPerson, ReminderSettings, RemindersOverview, SavedAudience } from "./types";

type Client = Awaited<ReturnType<typeof createClient>>;

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = <T,>(v: unknown): T | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as T) : null);

export async function loadBroadcasts(supabase: Client): Promise<BroadcastRow[]> {
  const { data } = await supabase.rpc("broadcast_list");
  return arr<BroadcastRow>(data);
}
export async function loadBroadcast(supabase: Client, id: string): Promise<Broadcast | null> {
  const { data, error } = await supabase.rpc("broadcast_get", { p_id: id });
  return error ? null : obj<Broadcast>(data);
}
export async function loadResults(supabase: Client, id: string): Promise<BroadcastResults | null> {
  const { data, error } = await supabase.rpc("broadcast_results", { p_id: id });
  return error ? null : obj<BroadcastResults>(data);
}
export async function loadApprovals(supabase: Client): Promise<ApprovalRow[]> {
  const { data } = await supabase.rpc("broadcast_approvals");
  return arr<ApprovalRow>(data);
}
export async function loadSavedAudiences(supabase: Client): Promise<SavedAudience[]> {
  const { data } = await supabase.rpc("audiences_list");
  return arr<SavedAudience>(data);
}
export async function loadReminders(supabase: Client): Promise<RemindersOverview | null> {
  const { data, error } = await supabase.rpc("reminders_overview");
  return error ? null : obj<RemindersOverview>(data);
}
export async function loadJourneyPeople(supabase: Client, key: string): Promise<JourneyPerson[]> {
  const { data } = await supabase.rpc("journey_people", { p_key: key, p_limit: 50 });
  return arr<JourneyPerson>(data);
}
export async function loadAsks(supabase: Client): Promise<AskRow[]> {
  const { data } = await supabase.rpc("asks_queue");
  return arr<AskRow>(data);
}
export async function loadMySwitches(supabase: Client): Promise<EmailSwitches | null> {
  const { data, error } = await supabase.rpc("my_email_switches");
  return error ? null : obj<EmailSwitches>(data);
}

/** The communities a champion writes to, or all of them for the office (the database narrows it again). */
export async function loadCommunities(supabase: Client): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase.from("communities").select("id, name").order("name");
  return arr<{ id: string; name: string }>(data);
}

export type AnnounceContext = {
  champion: boolean;
  communities: { id: string; name: string }[];
  saved: SavedAudience[];
  site: string;
  church: { name: string; address: string };
  threshold: number;
  perMinute: number;
  hours: { from: number; to: number };
  /** The office sets these; a champion sees the defaults, which are what the database starts with. */
  settings: ReminderSettings | null;
};

/** Everything the composer needs, for the office or for a community champion. */
export async function loadAnnounceContext(supabase: Client, session: Session): Promise<AnnounceContext> {
  const office = hasAnyRole(session.roles, ["admin", "director", "pastor"]);
  const champion = !office && session.roles.includes("community_champion");
  const [overview, saved, all, mine] = await Promise.all([
    office || session.roles.includes("data_lead") ? loadReminders(supabase) : Promise.resolve(null),
    loadSavedAudiences(supabase),
    loadCommunities(supabase),
    champion ? supabase.from("community_champions").select("community_id").eq("person_id", session.person.id) : Promise.resolve({ data: [] as { community_id: string }[] }),
  ]);
  const own = new Set(arr<{ community_id: string }>(mine.data).map((r) => r.community_id));
  const s = overview?.settings ?? null;
  return {
    champion,
    communities: champion ? all.filter((c) => own.has(c.id)) : all,
    saved,
    site: siteUrl(),
    church: { name: s?.church_name ?? "The Covenant Nation", address: s?.church_address ?? "" },
    threshold: s?.approval_threshold ?? 200,
    perMinute: s?.bulk_per_minute ?? 300,
    hours: { from: s?.bulk_start_hour ?? 8, to: s?.bulk_end_hour ?? 20 },
    settings: s,
  };
}

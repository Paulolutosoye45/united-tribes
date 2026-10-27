import "server-only";
import type { Catalogue } from "@/components/intake/types";
import { loadCatalogue } from "@/lib/intake/server";
import type { createClient } from "@/lib/supabase/server";
import { parseLeaderAnswers, type LeaderAnswers } from "./answers";
import { parseLeadingPeople, parseMyLeading, type LeadingPerson, type MyLeading } from "./leading";
import { DEFAULT_MODES, modesFromPipeline, parseModes, type StageModes } from "./modes";
import { DEFAULT_PIPELINE, parsePipeline, type Pipeline } from "./pipeline";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Row = Record<string, unknown>;

export type Track = { slug: string; name: string; description: string; ages: string };
export type LeaderCatalogue = { tracks: Track[]; communities: Catalogue["communities"] };

function ages(min: unknown, max: unknown) {
  if (max === null || max === undefined) return `${min}+`;
  return `${min}–${max}`;
}

/** The life-stage tracks that are open, and the communities with their goals. Retired ones only where tribes already made are shown. */
export async function loadLeaderCatalogue(supabase: Supabase, options: { includeRetired?: boolean } = {}): Promise<LeaderCatalogue> {
  const [{ catalogue }, tracks] = await Promise.all([
    loadCatalogue(supabase, options),
    supabase.from("tracks").select("slug, name, description, min_age, max_age, sort, active").eq("active", true).order("sort"),
  ]);
  return {
    communities: catalogue.communities,
    tracks: ((tracks.data as Row[] | null) ?? []).map((t) => ({
      slug: String(t.slug),
      name: String(t.name),
      description: String(t.description ?? ""),
      ages: ages(t.min_age, t.max_age),
    })),
  };
}

/**
 * Where each switch for becoming a leader stands. If the database cannot be asked, or answers in a way nobody expects, this is
 * today's process (every question, both referees and the interview), so a failure to read only ever makes the screens stricter.
 */
export async function loadPipeline(supabase: Supabase): Promise<Pipeline> {
  try {
    const { data, error } = await supabase.rpc("leader_pipeline_public");
    if (error) return structuredClone(DEFAULT_PIPELINE);
    return parsePipeline(data);
  } catch {
    return structuredClone(DEFAULT_PIPELINE);
  }
}

/**
 * Which steps apply to one application. For one that exists, the database works it out (my_application_modes): the position now for a
 * draft, and the more lenient of when it was sent and now for one that is sent. For someone who has not started, it is the positions
 * now. If neither can be read, every step is asked, as before the switchboard.
 */
export async function loadApplyModes(supabase: Supabase, applicationId: string | null): Promise<StageModes> {
  try {
    if (applicationId) {
      const { data, error } = await supabase.rpc("my_application_modes", { p_app: applicationId });
      if (!error && data) return parseModes(data);
    }
    return modesFromPipeline(await loadPipeline(supabase));
  } catch {
    return structuredClone(DEFAULT_MODES);
  }
}

export type ApplicationRecord = {
  id: string;
  status: string;
  step: string;
  answers: LeaderAnswers;
  failedChecks: string[];
  submittedAt: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
};

export type ReferenceRecord = {
  id: string;
  slot: 1 | 2;
  name: string;
  relationship: string;
  contact: string;
  head: boolean;
  answered: boolean;
  /** "email" or "phone": how the request reaches them. Never the link itself: the applicant is not given it. */
  kind: "email" | "phone" | null;
  /** Where the request has got to: waiting, sending, sent, opened, verified, answered or unreachable. */
  stage: string;
  sentAt: string | null;
  requests: number;
  /** Times this person was swapped after a request had gone out. */
  changes: number;
};

/** The person’s latest application and the referees they named. RLS shows them only their own. */
export async function loadMyApplication(
  supabase: Supabase,
  personId: string,
): Promise<{ application: ApplicationRecord | null; references: ReferenceRecord[] }> {
  const { data } = await supabase
    .from("leader_applications")
    .select("id, status, step, answers, failed_checks, submitted_at, decided_at, decision_note, created_at")
    .eq("person_id", personId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return { application: null, references: [] };

  const refs = await supabase
    .from("leader_references")
    .select("id, slot, referee_name, relationship, contact, is_pastor_or_unit_head, submitted_at, contact_kind, stage, sent_at, requests, changes")
    .eq("application_id", data.id)
    .order("slot");

  return {
    application: {
      id: data.id,
      status: data.status,
      step: data.step,
      answers: parseLeaderAnswers(data.answers),
      failedChecks: data.failed_checks ?? [],
      submittedAt: data.submitted_at,
      decidedAt: data.decided_at,
      decisionNote: data.decision_note,
      createdAt: data.created_at,
    },
    references: (refs.data ?? []).map((r) => ({
      id: r.id,
      slot: r.slot === 2 ? 2 : 1,
      name: r.referee_name,
      relationship: r.relationship,
      contact: r.contact,
      head: r.is_pastor_or_unit_head,
      answered: r.submitted_at !== null,
      kind: r.contact_kind === "email" || r.contact_kind === "phone" ? r.contact_kind : null,
      stage: r.submitted_at !== null ? "answered" : typeof r.stage === "string" ? r.stage : "waiting",
      sentAt: typeof r.sent_at === "string" ? r.sent_at : null,
      requests: typeof r.requests === "number" ? r.requests : 0,
      changes: typeof r.changes === "number" ? r.changes : 0,
    })),
  };
}

/**
 * The tribe the signed-in leader leads, however they came to lead it. Null when they lead nothing, and when the database cannot be asked
 * (or does not have the function yet): the Lead page is then exactly as it was.
 */
export async function loadMyLeading(supabase: Supabase): Promise<MyLeading | null> {
  try {
    const { data, error } = await supabase.rpc("my_leading");
    return error ? null : parseMyLeading(data);
  } catch {
    return null;
  }
}

/** The people who have joined a tribe, through the leader's own list, so that its rules about who is shown apply. Null when it cannot be read. */
export async function loadLeadingPeople(supabase: Supabase, tribeId: string): Promise<LeadingPerson[] | null> {
  try {
    const { data, error } = await supabase.rpc("tribe_roster_marked", { p_tribe: tribeId });
    return error ? null : parseLeadingPeople(data);
  } catch {
    return null;
  }
}

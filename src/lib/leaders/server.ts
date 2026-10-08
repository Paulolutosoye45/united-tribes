import "server-only";
import type { Catalogue } from "@/components/intake/types";
import { loadCatalogue } from "@/lib/intake/server";
import type { createClient } from "@/lib/supabase/server";
import { parseLeaderAnswers, type LeaderAnswers } from "./answers";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Row = Record<string, unknown>;

export type Track = { slug: string; name: string; description: string; ages: string };
export type LeaderCatalogue = { tracks: Track[]; tribes: Catalogue["tribes"] };

function ages(min: unknown, max: unknown) {
  if (max === null || max === undefined) return `${min}+`;
  return `${min}–${max}`;
}

/** The life-stage tracks that are open, and the tribes with their goals. */
export async function loadLeaderCatalogue(supabase: Supabase): Promise<LeaderCatalogue> {
  const [{ catalogue }, tracks] = await Promise.all([
    loadCatalogue(supabase),
    supabase.from("tracks").select("slug, name, description, min_age, max_age, sort, active").eq("active", true).order("sort"),
  ]);
  return {
    tribes: catalogue.tribes,
    tracks: ((tracks.data as Row[] | null) ?? []).map((t) => ({
      slug: String(t.slug),
      name: String(t.name),
      description: String(t.description ?? ""),
      ages: ages(t.min_age, t.max_age),
    })),
  };
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
  expired: boolean;
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
    .select("id, slot, referee_name, relationship, contact, is_pastor_or_unit_head, token_expires_at, submitted_at")
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
      expired: new Date(r.token_expires_at).getTime() < Date.now(),
    })),
  };
}

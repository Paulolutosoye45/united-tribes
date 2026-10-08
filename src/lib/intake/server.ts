import "server-only";
import type { Catalogue } from "@/components/intake/types";
import { parseDraftAnswers, type Answers } from "./answers";

type Row = Record<string, unknown>;

/** The editable vocabulary (ranges, tribes, goals), as the form needs it. */
export async function loadCatalogue(supabase: {
  from: (table: string) => { select: (columns: string) => PromiseLike<{ data: unknown }> };
}): Promise<{ catalogue: Catalogue; ids: CatalogueIds }> {
  const [ranges, tribes] = await Promise.all([
    supabase.from("age_ranges").select("id, slug, label, sort, track:tracks(active)"),
    supabase.from("tribes").select("id, slug, name, description, sort, season_goals(id, slug, title, sort)"),
  ]);

  const ageRows = ((ranges.data as Row[] | null) ?? []).sort((a, b) => Number(a.sort) - Number(b.sort));
  const tribeRows = ((tribes.data as Row[] | null) ?? []).sort((a, b) => Number(a.sort) - Number(b.sort));

  const ids: CatalogueIds = { ageById: new Map(), tribeById: new Map(), goalById: new Map() };
  const catalogue: Catalogue = {
    ageRanges: ageRows.map((r) => {
      const track = Array.isArray(r.track) ? r.track[0] : r.track;
      ids.ageById.set(String(r.id), String(r.slug));
      return { slug: String(r.slug), label: String(r.label), open: Boolean((track as Row | undefined)?.active) };
    }),
    tribes: tribeRows.map((t) => {
      ids.tribeById.set(String(t.id), String(t.slug));
      const goals = ((t.season_goals as Row[] | null) ?? []).sort((a, b) => Number(a.sort) - Number(b.sort));
      for (const g of goals) ids.goalById.set(String(g.id), String(g.slug));
      return {
        slug: String(t.slug),
        name: String(t.name),
        description: String(t.description ?? ""),
        goals: goals.map((g) => ({ slug: String(g.slug), title: String(g.title) })),
      };
    }),
  };
  return { catalogue, ids };
}

export type CatalogueIds = {
  ageById: Map<string, string>;
  tribeById: Map<string, string>;
  goalById: Map<string, string>;
};

/** Turns a saved profile row back into answers, so a person can edit it. */
export function profileToAnswers(row: Row, ids: CatalogueIds, names: { preferredName: string | null; fullName: string | null }): Answers {
  const answers = {
    ageRange: ids.ageById.get(String(row.age_range_id)),
    birthdayDay: row.birthday_day ?? undefined,
    birthdayMonth: row.birthday_month ?? undefined,
    preferredName: names.preferredName ?? undefined,
    fullName: names.fullName ?? undefined,
    gender: row.gender,
    circleMix: row.circle_mix,
    zone: row.zone,
    areaNote: row.area_note ?? undefined,
    story: row.story ?? undefined,
    tribe: row.tribe_id ? ids.tribeById.get(String(row.tribe_id)) : undefined,
    tribeOther: row.tribe_other ?? undefined,
    faith: row.faith_journey,
    goal: row.season_goal_id ? ids.goalById.get(String(row.season_goal_id)) : undefined,
    goalOther: row.goal_other ?? undefined,
    successStatement: row.success_statement ?? undefined,
    baseline: row.goal_baseline,
    meetingMode: row.meeting_mode,
    times: row.meeting_times,
    styleSocial: row.style_social,
    styleStructure: row.style_structure,
    styleOpenness: row.style_openness,
    styleDirectness: row.style_directness,
    styleDisclosure: row.style_disclosure,
    styleLearning: row.style_learning,
    openToServing: row.open_to_serving ?? undefined,
    supportNeeds: row.support_needs ?? undefined,
    whatsapp: row.whatsapp ?? undefined,
    whatsappOk: row.whatsapp ? true : undefined,
    assist: row.ai_assist,
  };
  return parseDraftAnswers(answers);
}

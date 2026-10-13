import "server-only";
import type { Catalogue } from "@/components/intake/types";
import { draftContext, leaderNoteContext, open, supportContext } from "@/lib/crypto/seal";
import type { Contact } from "@/lib/messaging/contact";
import { parseDraftAnswers, type Answers } from "./answers";
import { SUPPORT_CHIPS } from "./options";

type Row = Record<string, unknown>;

/**
 * The editable vocabulary (ranges, communities, goals), as the form needs it. A retired community or goal is left out of what is
 * offered, but `ids` still knows it, so a member who chose it earlier can be shown their own answer. Screens that look at
 * tribes already made (the review pages) ask for `includeRetired`; the member form passes `keep` with the ids a member
 * already chose, so their own retired community or goal is still shown to them (and only to them).
 */
export async function loadCatalogue(
  supabase: {
    from: (table: string) => { select: (columns: string) => PromiseLike<{ data: unknown }> };
  },
  options: { includeRetired?: boolean; keep?: (string | null | undefined)[] } = {},
): Promise<{ catalogue: Catalogue; ids: CatalogueIds }> {
  const [ranges, communities] = await Promise.all([
    supabase.from("age_ranges").select("id, slug, label, sort, track:tracks(active)"),
    supabase.from("communities").select("id, slug, name, description, sort, active, season_goals(id, slug, title, sort, active)"),
  ]);

  const ageRows = ((ranges.data as Row[] | null) ?? []).sort((a, b) => Number(a.sort) - Number(b.sort));
  const allCommunities = ((communities.data as Row[] | null) ?? []).sort((a, b) => Number(a.sort) - Number(b.sort));
  // `keep` lists ids (communities and goals) a person already chose: they stay in front of that person even once retired.
  const kept = new Set((options.keep ?? []).filter((v): v is string => typeof v === "string"));
  const offered = (row: Row) => options.includeRetired === true || row.active !== false || kept.has(String(row.id));

  const ids: CatalogueIds = { ageById: new Map(), communityById: new Map(), goalById: new Map() };
  const catalogue: Catalogue = {
    ageRanges: ageRows.map((r) => {
      const track = Array.isArray(r.track) ? r.track[0] : r.track;
      ids.ageById.set(String(r.id), String(r.slug));
      return { slug: String(r.slug), label: String(r.label), open: Boolean((track as Row | undefined)?.active) };
    }),
    communities: allCommunities
      .map((t) => {
        ids.communityById.set(String(t.id), String(t.slug));
        const goals = ((t.season_goals as Row[] | null) ?? []).sort((a, b) => Number(a.sort) - Number(b.sort));
        for (const g of goals) ids.goalById.set(String(g.id), String(g.slug));
        return { row: t, goals: goals.filter(offered) };
      })
      .filter(({ row }) => offered(row))
      .map(({ row: t, goals }) => ({
        slug: String(t.slug),
        name: String(t.name),
        description: String(t.description ?? ""),
        goals: goals.map((g) => ({ slug: String(g.slug), title: String(g.title) })),
      })),
  };
  return { catalogue, ids };
}

export type CatalogueIds = {
  ageById: Map<string, string>;
  communityById: Map<string, string>;
  goalById: Map<string, string>;
};

/** What a person sealed, opened again for them (and only them). */
export function openPrivate(row: Row, personId: string): Pick<Answers, "supportChips" | "supportNote" | "leaderNote"> {
  const out: Pick<Answers, "supportChips" | "supportNote" | "leaderNote"> = {};
  const support = open(row.support_enc as string | null, supportContext(personId));
  if (support) {
    try {
      const parsed = JSON.parse(support) as { chips?: unknown; note?: unknown };
      const known = new Set<string>(SUPPORT_CHIPS.map((c) => c.id));
      if (Array.isArray(parsed.chips)) out.supportChips = parsed.chips.filter((c): c is (typeof SUPPORT_CHIPS)[number]["id"] => typeof c === "string" && known.has(c));
      if (typeof parsed.note === "string") out.supportNote = parsed.note;
    } catch {
      // A note that does not read is treated as not there rather than breaking the form.
    }
  }
  const note = open(row.leader_note_enc as string | null, leaderNoteContext(personId));
  if (note) out.leaderNote = note;
  return out;
}

/** The private notes saved with a draft, opened again for the person who wrote them. */
export function openSealedDraft(token: string | null | undefined, personId: string): Pick<Answers, "supportChips" | "supportNote" | "leaderNote"> {
  const text = open(token, draftContext(personId));
  if (!text) return {};
  try {
    const parsed = parseDraftAnswers(JSON.parse(text));
    return { supportChips: parsed.supportChips, supportNote: parsed.supportNote, leaderNote: parsed.leaderNote };
  } catch {
    return {};
  }
}

/** Turns a saved profile row back into answers, so a person can edit it. */
export function profileToAnswers(
  row: Row,
  ids: CatalogueIds,
  names: { preferredName: string | null; fullName: string | null },
  contact: Contact | null = null,
): Answers {
  const personId = String(row.person_id);
  const answers = {
    ageRange: ids.ageById.get(String(row.age_range_id)),
    birthdayDay: row.birthday_day ?? undefined,
    birthdayMonth: row.birthday_month ?? undefined,
    preferredName: names.preferredName ?? undefined,
    fullName: names.fullName ?? undefined,
    gender: row.gender,
    tribeMix: row.tribe_mix,
    zone: row.zone,
    areaNote: row.area_note ?? undefined,
    areaSlug: row.area_slug ?? undefined,
    openToAdjacent: row.open_to_adjacent ?? undefined,
    story: row.story ?? undefined,
    relationship: row.relationship ?? undefined,
    children: Array.isArray(row.children) && row.children.length > 0 ? row.children : undefined,
    workStatus: row.work_status ?? undefined,
    workField: row.work_field ?? undefined,
    community: row.community_id ? ids.communityById.get(String(row.community_id)) : undefined,
    communityOther: row.community_other ?? undefined,
    secondCommunity: row.second_community_id ? ids.communityById.get(String(row.second_community_id)) : undefined,
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
    groupRoles: Array.isArray(row.group_roles) && row.group_roles.length > 0 ? row.group_roles : undefined,
    openToServing: row.open_to_serving ?? undefined,
    ...openPrivate(row, personId),
    phone: contact?.phone ?? undefined,
    whatsappOk: contact ? contact.whatsapp : undefined,
    smsOk: contact ? contact.sms : undefined,
    emailOk: contact ? contact.email_ok : undefined,
    channel: contact?.preferred,
    assist: row.ai_assist,
  };
  return parseDraftAnswers(answers);
}

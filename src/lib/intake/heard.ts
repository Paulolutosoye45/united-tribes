import { CHILDREN, GROUP_ROLES, RELATIONSHIPS, WORK_FIELDS, WORK_STATUSES, aiOptions, type HeardOption } from "./options";

/**
 * The "We heard…" questions the assistant answers from a person's season story. Each is a closed list; the
 * assistant can only pick from it (see src/lib/ai/suggest.ts), and the browser never sends the list: the server
 * builds it from here.
 */
export type HeardField = "relationship" | "children" | "work_status" | "work_field";

export const HEARD_FIELDS: readonly HeardField[] = ["relationship", "children", "work_status", "work_field"];

export type SuggestableField = HeardField | "group_roles";

type Spec = { question: string; options: readonly HeardOption[]; max: number };

export const FIELD_SPECS: Record<SuggestableField, Spec> = {
  relationship: {
    question: "Is this person single, in a relationship, engaged or married? Say so only if they state it.",
    options: RELATIONSHIPS,
    max: 1,
  },
  children: {
    question: "Which describes the children this person has, if they mention any? More than one can apply.",
    options: CHILDREN,
    max: 3,
  },
  work_status: { question: "What is this person's work situation right now?", options: WORK_STATUSES, max: 1 },
  work_field: { question: "Which field does this person work or study in?", options: WORK_FIELDS, max: 1 },
  group_roles: {
    question:
      "Which roles would this person most naturally play in a small group, judging only by how they describe themselves? Suggest none unless the text makes it clear.",
    options: GROUP_ROLES,
    max: 2,
  },
};

/** The options as the assistant is shown them: only those it may suggest, with everyday wording attached. */
export function specFor(field: SuggestableField) {
  const spec = FIELD_SPECS[field];
  return { question: spec.question, options: aiOptions(spec.options), max: spec.max };
}

/**
 * What to pre-select from the assistant's picks. A single-answer question takes its best pick. For children, "no children"
 * cannot sit beside any other answer, so if the assistant offered both (one word such as "kids" can match both), the
 * positive statement wins: it only appears when the person actually mentioned children.
 */
export function settleSuggested(field: SuggestableField, ids: readonly string[]): string[] {
  const unique = [...new Set(ids)].slice(0, FIELD_SPECS[field].max);
  if (field === "children" && unique.length > 1) return unique.filter((id) => id !== "none");
  return unique;
}

/**
 * The facts a person has confirmed, as short lines for the assistant to use alongside their story. Only work and
 * family answers, and never the painful ones (`ai: false`): the assistant is told what helps it choose a community or
 * a goal, and nothing it should not carry.
 */
export function knownLines(known: {
  workStatus?: string;
  workField?: string;
  relationship?: string;
  children?: readonly string[];
}): string[] {
  const label = (list: readonly HeardOption[], id?: string) => {
    const option = list.find((o) => o.id === id);
    return option && option.ai !== false ? option.label : null;
  };
  const lines: string[] = [];
  const work = label(WORK_STATUSES, known.workStatus);
  if (work) lines.push(`Work: ${work}`);
  const field = known.workField === "other" ? null : label(WORK_FIELDS, known.workField);
  if (field) lines.push(`Field: ${field}`);
  const relationship = label(RELATIONSHIPS, known.relationship);
  if (relationship) lines.push(`Relationship: ${relationship}`);
  const children = (known.children ?? []).map((c) => label(CHILDREN, c)).filter((x): x is string => Boolean(x));
  if (children.length > 0) lines.push(`Children: ${children.join(", ")}`);
  return lines;
}

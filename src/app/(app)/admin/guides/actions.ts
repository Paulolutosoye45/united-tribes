"use server";

import { plain, run, text, type Result } from "@/lib/admin/rpc";
import type { GuideDraft } from "@/lib/admin/types";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";

const bad: Result = { ok: false, message: TRY_AGAIN };
const week = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 12;
const phase = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 3;

function pages(n: number) {
  return ["/admin/guides", `/admin/guides/${n}`, "/admin"];
}

/** Saves a guide, which also marks it as read by the person who saved it. Every tribe reads the guide live. */
export async function saveGuideAction(n: number, draft: GuideDraft): Promise<Result> {
  if (!week(n) || !draft || typeof draft !== "object") return bad;
  const questions = Array.isArray(draft.questions) ? draft.questions.slice(0, 3).map((q) => text(q, 600)) : [];
  const data = {
    title: text(draft.title, 300),
    passage: text(draft.passage, 300),
    sermon_series: text(draft.sermon_series ?? "", 300),
    sermon_title: text(draft.sermon_title ?? "", 400),
    big_idea: text(draft.big_idea, 1500),
    opening_question: text(draft.opening_question, 500),
    questions,
    practice: text(draft.practice, 1200),
    step_hint: text(draft.step_hint, 800),
    prayer: text(draft.prayer, 1200),
    confession: text(draft.confession ?? "", 800),
    leader_tip: text(draft.leader_tip, 1200),
    word_how: text(draft.word_how, 2000),
    talk_how: text(draft.talk_how, 2000),
  };
  return plain(await run("save_week_guide", { p_week: n, p_data: data }, pages(n)));
}

export async function markGuideReviewedAction(n: number): Promise<Result> {
  if (!week(n)) return bad;
  return plain(await run("mark_guide_reviewed", { p_week: n }, pages(n)));
}

export async function saveCommunityPromptAction(community: string, p: number, value: string): Promise<Result> {
  if (!isUuid(community) || !phase(p)) return bad;
  return plain(await run("save_community_prompt", { p_community: community, p_phase: p, p_text: text(value, 600) }, ["/admin/guides/layers"]));
}

export async function saveGoalIdeaAction(goal: string, p: number, value: string): Promise<Result> {
  if (!isUuid(goal) || !phase(p)) return bad;
  return plain(await run("save_goal_idea", { p_goal: goal, p_phase: p, p_text: text(value, 600) }, ["/admin/guides/layers"]));
}

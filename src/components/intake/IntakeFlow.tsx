"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlowFrame, type SaveState } from "@/components/flow/FlowFrame";
import { TEENS, type Answers } from "@/lib/intake/answers";
import { STYLE_PAIRS } from "@/lib/intake/options";
import {
  MAX_SECONDS_PER_STEP,
  SECTIONS,
  SKIPPABLE,
  STEP_IDS,
  canContinue,
  nextStep,
  previousStep,
  sectionOf,
  shieldFills,
  timeLeftLabel,
  type StepId,
} from "@/lib/intake/steps";
import { createClient } from "@/lib/supabase/browser";
import { recordConsentAction, submitIntakeAction } from "@/app/(focus)/join/actions";
import { Done } from "./Done";
import { ExtrasStep, RhythmStep, ReviewStep, StyleStep } from "./StepsRhythm";
import { FaithStep, GoalStep, StoryStep, SuccessStep, TribeStep } from "./StepsSeason";
import { AgeStep, GenderStep, NameStep, WhereStep } from "./StepsYou";
import type { Catalogue } from "./types";
import { useSuggestions } from "./useSuggestions";
import { Welcome } from "./Welcome";

export type View = "welcome" | StepId | "done";

export type IntakeProps = {
  personId: string;
  catalogue: Catalogue;
  aiAvailable: boolean;
  seasonName: string | null;
  seasonStarts: string | null;
  initial: { view: View; answers: Answers; activeSeconds: number; ai: boolean; isEdit: boolean };
};

/** Drafts never hold a teen's answers, and never hold consent flags. */
function draftOf(answers: Answers): Answers {
  const copy = { ...answers };
  if (copy.ageRange === TEENS) delete copy.ageRange;
  return copy;
}

export function IntakeFlow({ personId, catalogue, aiAvailable, seasonName, seasonStarts, initial }: IntakeProps) {
  const router = useRouter();
  const [view, setView] = useState<View>(initial.view);
  const [dir, setDir] = useState<"forward" | "back">("forward");
  const [answers, setAnswers] = useState<Answers>(initial.answers);
  const [ai, setAi] = useState(initial.ai);
  const [agreed, setAgreed] = useState(initial.view !== "welcome");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [doneSeconds, setDoneSeconds] = useState(0);
  const [reviewMode, setReviewMode] = useState(initial.isEdit);

  const answersRef = useRef(answers);
  const activeRef = useRef(initial.activeSeconds);
  const stepStart = useRef(0);
  const saveChain = useRef<Promise<void>>(Promise.resolve());

  const assistantOn = aiAvailable && ai;
  const sugg = useSuggestions(assistantOn);

  useEffect(() => {
    stepStart.current = Date.now();
  }, []);

  const set = useCallback((patch: Partial<Answers>) => {
    const next = { ...answersRef.current, ...patch };
    answersRef.current = next;
    setAnswers(next);
  }, []);

  function tick() {
    const now = Date.now();
    activeRef.current += Math.min(MAX_SECONDS_PER_STEP, (now - stepStart.current) / 1000);
    stepStart.current = now;
  }

  function persist(step: StepId): Promise<void> {
    if (initial.isEdit) return Promise.resolve();
    const snapshot = draftOf(answersRef.current);
    const seconds = Math.round(activeRef.current);
    saveChain.current = saveChain.current.then(async () => {
      setSaveState("saving");
      try {
        const { error } = await createClient()
          .from("intake_drafts")
          .upsert({ person_id: personId, step, answers: snapshot, active_seconds: seconds }, { onConflict: "person_id" });
        setSaveState(error ? "error" : "saved");
      } catch {
        setSaveState("error");
      }
    });
    return saveChain.current;
  }

  function go(target: View, direction: "forward" | "back") {
    tick();
    setProblem(null);
    setDir(direction);
    setView(target);
    window.scrollTo({ top: 0, behavior: "instant" });
    if (target !== "welcome" && target !== "done") void persist(target);
  }

  /** Remember what the assistant showed and what the person chose: ids only. */
  function buildAssist(): Answers["assist"] {
    const story = answers.story ?? "";
    const out: NonNullable<Answers["assist"]> = {};
    const t = sugg.get("tribe", story);
    if (t?.status === "ready" && t.items.length > 0) {
      out.tribe = { shown: t.items.map((i) => i.id), chosen: answers.tribe ?? null };
    }
    const g = answers.tribe ? sugg.get("season_goal", story, answers.tribe) : null;
    if (g?.status === "ready" && g.items.length > 0) {
      out.season_goal = { shown: g.items.map((i) => i.id), chosen: answers.goal ?? null };
    }
    return out;
  }

  async function begin() {
    setBusy(true);
    setProblem(null);
    const result = await recordConsentAction({ ai: assistantOn });
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setAgreed(true);
    go("age", "forward");
  }

  async function submit() {
    tick();
    setBusy(true);
    setProblem(null);
    const payload = { ...answersRef.current, assist: buildAssist() };
    const result = await submitIntakeAction(payload, Math.round(activeRef.current), initial.isEdit);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      if (result.step === "welcome") setView("welcome");
      else if (result.step && STEP_IDS.includes(result.step as StepId)) {
        setReviewMode(true);
        go(result.step as StepId, "back");
        setProblem(result.message);
      }
      return;
    }
    setDoneSeconds(result.durationSeconds ?? Math.round(activeRef.current));
    setDir("forward");
    setView("done");
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function onContinue() {
    if (busy) return;
    if (view === "welcome") return void begin();
    if (view === "review") return void submit();
    if (view === "done") return;
    if (view === "story") sugg.request("tribe", answers.story ?? "");
    if (view === "tribe" && answers.tribe) sugg.request("season_goal", answers.story ?? "", answers.tribe);
    // Changing the tribe from the review means the goal must be chosen again.
    if (reviewMode && view === "tribe" && !canContinue("goal", answers)) return go("goal", "forward");
    if (reviewMode) return go("review", "forward");
    go(nextStep(view), "forward");
  }

  function onBack() {
    if (view === "welcome" || view === "done") return;
    if (reviewMode && view !== "review") return go("review", "back");
    const prev = previousStep(view);
    if (prev) go(prev, "back");
  }

  function onEdit(step: StepId) {
    setReviewMode(true);
    go(step, "back");
  }

  async function finishLater() {
    tick();
    if (view !== "welcome" && view !== "done") await persist(view);
    router.push("/home");
  }

  if (view === "done") {
    return (
      <Done
        name={answers.preferredName ?? ""}
        seconds={doneSeconds}
        isEdit={initial.isEdit}
        seasonName={seasonName}
        seasonStarts={seasonStarts}
      />
    );
  }

  const fills = shieldFills(view);
  const section = view === "welcome" || view === "review" ? -1 : sectionOf(view);
  const stepNo = view === "welcome" ? 0 : STEP_IDS.indexOf(view) + 1;
  const onWelcome = view === "welcome";
  const goalTitle = catalogue.tribes.find((t) => t.slug === answers.tribe)?.goals.find((g) => g.slug === answers.goal)?.title ?? null;
  const storyForAi = answers.story ?? "";
  const tribeSugg = { entry: sugg.get("tribe", storyForAi), enabled: assistantOn };
  const goalSugg = { entry: answers.tribe ? sugg.get("season_goal", storyForAi, answers.tribe) : null, enabled: assistantOn };

  const canGo = onWelcome ? agreed || false : canContinue(view as StepId, answers);
  const skipping = SKIPPABLE.includes(view as StepId) && isEmptyStep(view as StepId, answers);
  const label =
    view === "welcome" ? "I agree, let’s begin" : view === "review" ? (initial.isEdit ? "Save changes" : "Save my answers") : skipping ? "Skip for now" : "Continue";

  const caption = onWelcome
    ? "A few minutes"
    : view === "review"
      ? "Last step"
      : `${SECTIONS[section]?.label ?? ""} · ${timeLeftLabel(view as StepId).toLowerCase()}`;

  return (
    <FlowFrame
      fills={fills}
      section={section}
      sections={SECTIONS}
      saveState={saveState}
      caption={caption}
      announce={onWelcome ? "Welcome" : `Question ${stepNo} of ${STEP_IDS.length}`}
      progressLabel="Form progress"
      onWelcome={onWelcome}
      leaveHref="/home"
      leaveLabel="Leave the form"
      onFinishLater={() => void finishLater()}
      complete={view === "review"}
      viewKey={view}
      dir={dir}
      showBack={!onWelcome && previousStep(view as StepId) !== null}
      onBack={onBack}
      onContinue={onContinue}
      primaryLabel={label}
      canGo={canGo}
      busy={busy}
      skipping={skipping}
      problem={problem && view !== "review" ? problem : null}
    >
      {view === "welcome" ? (
        <Welcome aiAvailable={aiAvailable} matching={agreed} ai={ai} onMatching={setAgreed} onAi={setAi} seasonName={seasonName} />
      ) : null}
      {view === "age" ? <AgeStep answers={answers} set={set} catalogue={catalogue} /> : null}
      {view === "name" ? <NameStep answers={answers} set={set} /> : null}
      {view === "gender" ? <GenderStep answers={answers} set={set} /> : null}
      {view === "where" ? <WhereStep answers={answers} set={set} /> : null}
      {view === "story" ? <StoryStep answers={answers} set={set} assistant={!aiAvailable ? "unavailable" : ai ? "on" : "off"} /> : null}
      {view === "tribe" ? (
        <TribeStep answers={answers} set={set} catalogue={catalogue} suggestions={tribeSugg} onPick={(slug) => sugg.request("season_goal", storyForAi, slug)} />
      ) : null}
      {view === "faith" ? <FaithStep answers={answers} set={set} /> : null}
      {view === "goal" ? <GoalStep answers={answers} set={set} catalogue={catalogue} suggestions={goalSugg} onPick={() => undefined} /> : null}
      {view === "success" ? <SuccessStep answers={answers} set={set} goalTitle={goalTitle} /> : null}
      {view === "rhythm" ? <RhythmStep answers={answers} set={set} /> : null}
      {view === "style" ? <StyleStep answers={answers} set={set} /> : null}
      {view === "extras" ? <ExtrasStep answers={answers} set={set} assistantNote={assistantOn} /> : null}
      {view === "review" ? <ReviewStep answers={answers} set={set} catalogue={catalogue} onEdit={onEdit} error={problem} /> : null}
    </FlowFrame>
  );
}

function isEmptyStep(step: StepId, a: Answers): boolean {
  if (step === "story") return !a.story?.trim();
  if (step === "extras") return !a.supportNeeds?.trim() && !a.whatsapp?.trim() && !a.openToServing;
  if (step === "style") return STYLE_PAIRS.every((p) => !a[p.key]);
  return false;
}

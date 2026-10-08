"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlowFrame, type SaveState } from "@/components/flow/FlowFrame";
import { createClient } from "@/lib/supabase/browser";
import {
  checkEligibilityAction,
  restartApplicationAction,
  saveRefereeAction,
  startApplicationAction,
  submitApplicationAction,
} from "@/app/(focus)/lead/apply/actions";
import { EMPTY_REFEREE, withNormalisedContact, type LeaderAnswers, type RefereeInput } from "@/lib/leaders/answers";
import { isScenarioId } from "@/lib/leaders/scenarios";
import type { LeaderCatalogue } from "@/lib/leaders/server";
import {
  SECTIONS,
  STEP_IDS,
  canContinue,
  nextStep,
  previousStep,
  sectionOf,
  shieldFills,
  timeLeftLabel,
  type Referees,
  type StepId,
} from "@/lib/leaders/steps";
import { Ineligible, Submitted } from "./ApplyEnds";
import {
  ContactStep,
  EligibilityStep,
  GoalStep,
  LeadBestStep,
  LeaderWelcome,
  RefereeStep,
  ReviewStep,
  ScenarioStep,
  StyleStep,
  TrackStep,
  TribeStep,
  WalkStep,
  WrittenStep,
  type Patch,
} from "./ApplySteps";

export type View = "welcome" | StepId | "ineligible" | "done";

export type ApplyProps = {
  personId: string;
  applicationId: string | null;
  catalogue: LeaderCatalogue;
  applicantName: string;
  initial: { view: View; answers: LeaderAnswers; referees: Referees; failed: string[] };
};

const trimmed = (r: RefereeInput) => JSON.stringify({ n: r.name.trim(), r: r.relationship.trim(), c: r.contact.trim(), h: r.head });

export function ApplyFlow({ personId, applicationId, catalogue, applicantName, initial }: ApplyProps) {
  const router = useRouter();
  const [appId, setAppId] = useState(applicationId);
  const [view, setView] = useState<View>(initial.view);
  const [dir, setDir] = useState<"forward" | "back">("forward");
  const [answers, setAnswers] = useState<LeaderAnswers>(initial.answers);
  const [referees, setReferees] = useState<Referees>(initial.referees);
  const [agreed, setAgreed] = useState(initial.view !== "welcome");
  const [failed, setFailed] = useState<string[]>(initial.failed);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [reviewMode, setReviewMode] = useState(false);

  const answersRef = useRef(answers);
  const appIdRef = useRef(applicationId);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const savedReferees = useRef<Record<number, string>>({
    1: initial.referees[1] ? trimmed(initial.referees[1]) : "",
    2: initial.referees[2] ? trimmed(initial.referees[2]) : "",
  });

  const patch: Patch = useCallback((section, value) => {
    const next = { ...answersRef.current, [section]: { ...answersRef.current[section], ...value } } as LeaderAnswers;
    answersRef.current = next;
    setAnswers(next);
  }, []);

  // Keep the same order of responses for the same person on every visit.
  const seed = appId ?? personId;

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  function persist(step: StepId): Promise<void> {
    const id = appIdRef.current;
    if (!id) return Promise.resolve();
    const snapshot = withNormalisedContact(answersRef.current);
    saveChain.current = saveChain.current.then(async () => {
      setSaveState("saving");
      try {
        const { error } = await createClient().from("leader_applications").update({ step, answers: snapshot }).eq("id", id);
        setSaveState(error ? "error" : "saved");
      } catch {
        setSaveState("error");
      }
    });
    return saveChain.current;
  }

  function go(target: View, direction: "forward" | "back") {
    setProblem(null);
    setDir(direction);
    setView(target);
    window.scrollTo({ top: 0, behavior: "instant" });
    if (target !== "welcome" && target !== "done" && target !== "ineligible") void persist(target);
  }

  async function begin() {
    setBusy(true);
    setProblem(null);
    const result = await startApplicationAction();
    setBusy(false);
    if (!result.ok) return setProblem(result.message);
    appIdRef.current = result.id;
    setAppId(result.id);
    go("eligibility", "forward");
  }

  async function restart() {
    if (!appIdRef.current) return;
    setBusy(true);
    setProblem(null);
    const result = await restartApplicationAction(appIdRef.current);
    setBusy(false);
    if (!result.ok) return setProblem(result.message);
    appIdRef.current = result.id;
    setAppId(result.id);
    answersRef.current = { eligibility: {}, calling: {}, scenarios: {}, style: {}, contact: {} };
    setAnswers(answersRef.current);
    setFailed([]);
    go("eligibility", "back");
  }

  async function checkEligibility() {
    setBusy(true);
    setProblem(null);
    await persist("eligibility");
    const result = await checkEligibilityAction(appIdRef.current!);
    setBusy(false);
    if (!result.ok) return setProblem(result.message);
    if (!result.eligible) {
      setFailed(result.failed);
      setDir("forward");
      setView("ineligible");
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    go(reviewMode ? "review" : "contact", "forward");
  }

  async function saveReferee(slot: 1 | 2) {
    const value = referees[slot];
    if (!value) return false;
    if (savedReferees.current[slot] === trimmed(value)) return true;
    setBusy(true);
    setProblem(null);
    const result = await saveRefereeAction(appIdRef.current!, slot, value);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return false;
    }
    savedReferees.current[slot] = trimmed(value);
    return true;
  }

  async function submit() {
    setBusy(true);
    setProblem(null);
    await persist("review");
    const result = await submitApplicationAction(appIdRef.current!);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      if (result.step && (STEP_IDS as readonly string[]).includes(result.step)) {
        setReviewMode(true);
        go(result.step as StepId, "back");
        setProblem(result.message);
      }
      return;
    }
    setDir("forward");
    setView("done");
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  async function onContinue() {
    if (busy) return;
    if (view === "welcome") return void begin();
    if (view === "done" || view === "ineligible") return;
    if (view === "review") return void submit();
    if (view === "eligibility") return void checkEligibility();
    if (view === "ref1" || view === "ref2") {
      if (!(await saveReferee(view === "ref1" ? 1 : 2))) return;
    }
    // Changing the tribe from the review means the goal must be chosen again.
    if (reviewMode && view === "tribe" && !canContinue("goal", answers, referees, agreed)) return go("goal", "forward");
    if (reviewMode) return go("review", "forward");
    go(nextStep(view), "forward");
  }

  function onBack() {
    if (view === "welcome" || view === "done" || view === "ineligible") return;
    if (reviewMode && view !== "review") return go("review", "back");
    const prev = previousStep(view);
    if (prev) go(prev, "back");
  }

  function onEdit(step: StepId) {
    setReviewMode(true);
    go(step, "back");
  }

  async function finishLater() {
    if (view !== "welcome" && view !== "done" && view !== "ineligible") await persist(view);
    router.push("/lead");
  }

  if (view === "done") return <Submitted name={applicantName} />;
  if (view === "ineligible") return <Ineligible failed={failed} onRestart={() => void restart()} restarting={busy} error={problem} />;

  const onWelcome = view === "welcome";
  const fills = shieldFills(view);
  const section = onWelcome || view === "review" ? -1 : sectionOf(view);
  const stepNo = onWelcome ? 0 : STEP_IDS.indexOf(view) + 1;
  const canGo = onWelcome ? agreed : canContinue(view, answers, referees, true);
  const label = onWelcome ? "I agree, start my application" : view === "review" ? "Send my application" : "Continue";
  const caption = onWelcome ? "About fifteen minutes" : view === "review" ? "Last step" : `${SECTIONS[section]?.label ?? ""} · ${timeLeftLabel(view).toLowerCase()}`;
  const c = answers.calling;
  const goalTitle = catalogue.tribes.find((t) => t.slug === c.tribe)?.goals.find((g) => g.slug === c.goal)?.title ?? c.goalOther?.trim() ?? null;

  const setReferee = (slot: 1 | 2) => (next: RefereeInput) => setReferees((r) => ({ ...r, [slot]: next }));

  return (
    <FlowFrame
      fills={fills}
      section={section}
      sections={SECTIONS}
      saveState={saveState}
      caption={caption}
      announce={onWelcome ? "Welcome" : `Question ${stepNo} of ${STEP_IDS.length}`}
      progressLabel="Application progress"
      onWelcome={onWelcome}
      leaveHref="/lead"
      leaveLabel="Leave the application"
      onFinishLater={() => void finishLater()}
      complete={view === "review"}
      viewKey={view}
      dir={dir}
      showBack={!onWelcome && previousStep(view) !== null}
      onBack={onBack}
      onContinue={() => void onContinue()}
      primaryLabel={label}
      canGo={canGo}
      busy={busy}
      problem={problem && view !== "review" && view !== "ref1" && view !== "ref2" ? problem : null}
    >
      {view === "welcome" ? <LeaderWelcome agreed={agreed} onAgree={setAgreed} /> : null}
      {view === "eligibility" ? <EligibilityStep answers={answers} patch={patch} /> : null}
      {view === "contact" ? <ContactStep answers={answers} patch={patch} /> : null}
      {view === "track" ? <TrackStep answers={answers} patch={patch} tracks={catalogue.tracks} /> : null}
      {view === "tribe" ? <TribeStep answers={answers} patch={patch} tribes={catalogue.tribes} /> : null}
      {view === "goal" ? <GoalStep answers={answers} patch={patch} tribes={catalogue.tribes} /> : null}
      {view === "goal-story" || view === "why" || view === "walked" || view === "obstacles" ? (
        <WrittenStep step={view} answers={answers} patch={patch} goalTitle={goalTitle} />
      ) : null}
      {view === "walk" ? <WalkStep answers={answers} patch={patch} /> : null}
      {isScenarioId(view) ? <ScenarioStep id={view} answers={answers} patch={patch} seed={seed} /> : null}
      {view === "style" ? <StyleStep answers={answers} patch={patch} /> : null}
      {view === "lead-best" ? <LeadBestStep answers={answers} patch={patch} /> : null}
      {view === "ref1" ? (
        <RefereeStep slot={1} value={referees[1] ?? EMPTY_REFEREE} onChange={setReferee(1)} headNeeded={false} error={problem} />
      ) : null}
      {view === "ref2" ? (
        <RefereeStep slot={2} value={referees[2] ?? EMPTY_REFEREE} onChange={setReferee(2)} headNeeded={!(referees[1]?.head)} error={problem} />
      ) : null}
      {view === "review" ? <ReviewStep answers={answers} referees={referees} catalogue={catalogue} onEdit={onEdit} error={problem} /> : null}
    </FlowFrame>
  );
}

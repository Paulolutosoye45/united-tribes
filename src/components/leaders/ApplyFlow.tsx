"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlowFrame, type SaveState } from "@/components/flow/FlowFrame";
import { createClient } from "@/lib/supabase/browser";
import {
  aiConsentAction,
  checkAnswerAction,
  checkEligibilityAction,
  chooseFitAction,
  clearRefereeAction,
  restartApplicationAction,
  runFitAction,
  saveRefereeAction,
  startApplicationAction,
  submitApplicationAction,
} from "@/app/(focus)/lead/apply/actions";
import { EMPTY_REFEREE, isBlankReferee, withNormalisedContact, type LeaderAnswers, type RefereeInput } from "@/lib/leaders/answers";
import { REQUIRED_MODES, type AcademyModes } from "@/lib/academy/modes";
import { allOptions, fitInputKey, type FitView } from "@/lib/leaders/fit";
import type { StageModes } from "@/lib/leaders/modes";
import { isScenarioId } from "@/lib/leaders/scenarios";
import type { LeaderCatalogue } from "@/lib/leaders/server";
import {
  FIT_INPUT_STEPS,
  FIT_VIEW,
  SECTIONS,
  activeSteps,
  canContinue,
  fitFills,
  nextStep,
  savedStep,
  sectionOf,
  shieldFills,
  timeLeftLabel,
  viewAfter,
  viewBefore,
  type FlowView,
  type Referees,
  type StepId,
} from "@/lib/leaders/steps";
import { Ineligible, Submitted } from "./ApplyEnds";
import { FindTribe } from "./FindTribe";
import {
  AiConsentStep,
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
  CommunityStep,
  WalkStep,
  WrittenStep,
  type AnswerNote,
  type Patch,
} from "./ApplySteps";

export type View = "welcome" | FlowView | "ineligible" | "done";

/** What the first check on written answers asks of this applicant. "off" means nothing is different from before. */
export type ApplyAi = {
  mode: "off" | "shadow" | "on";
  minWords: number;
  /** The sentence on the first screen, for the wording that applies now. */
  consentText: string;
  /** The draft started under the old wording and the first check is on: one new sentence to agree to. */
  needsConsent: boolean;
  /** The sentence to agree to when the wording has changed. */
  updatedConsentText: string;
};

export type ApplyProps = {
  personId: string;
  applicationId: string | null;
  catalogue: LeaderCatalogue;
  applicantName: string;
  ai: ApplyAi;
  /** Which steps apply to this application, as the database works them out. */
  modes: StageModes;
  /** The Academy and the declaration, for the words about what comes after. */
  training?: AcademyModes;
  /** Find your tribe is switched on: a screen after "how you lead best" where the leader chooses a tribe. Off changes nothing. */
  fit?: boolean;
  initial: { view: View; answers: LeaderAnswers; referees: Referees; failed: string[] };
};

/** The written steps that get a quick check, and the saved answer each one checks. */
const CHECKED: Partial<Record<StepId, string>> = {
  "goal-story": "goalStory",
  why: "why",
  walked: "walked",
  walk: "walkNote",
  obstacles: "obstacles",
};

const trimmed = (r: RefereeInput) => JSON.stringify({ n: r.name.trim(), r: r.relationship.trim(), c: r.contact.trim(), h: r.head });

export function ApplyFlow({ personId, applicationId, catalogue, applicantName, ai, modes, training = REQUIRED_MODES, fit = false, initial }: ApplyProps) {
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
  // What the quick check last said about the answer on screen. Cleared when the person edits or leaves.
  const [feedback, setFeedback] = useState<(AnswerNote & { step: StepId }) | null>(null);
  const [consentPending, setConsentPending] = useState(ai.needsConsent);
  const [consentAgreed, setConsentAgreed] = useState(false);
  // Find your tribe. It can be switched on while a leader is filling in, so the form can learn it from the database at the send.
  const [fitOn, setFitOn] = useState(fit);
  const [fitStatus, setFitStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [fitView, setFitView] = useState<FitView | null>(null);
  const [fitGoal, setFitGoal] = useState<string | null>(null);
  const [fitBackups, setFitBackups] = useState<string[]>([]);
  const [fitError, setFitError] = useState<string | null>(null);

  const showConsent = ai.mode === "on" && consentPending && (view === "review" || view in CHECKED);

  const answersRef = useRef(answers);
  const appIdRef = useRef(applicationId);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  // Counts every move between screens, so an answer that arrives after the leader has gone elsewhere is ignored
  const moves = useRef(0);
  // What the comparison read when the leader last chose, and the title of what they chose, in case the catalogue on the page is older
  const fitKey = useRef<string | null>(null);
  const fitChosen = useRef<{ slug: string; title: string } | null>(null);
  const savedReferees = useRef<Record<number, string>>({
    1: initial.referees[1] ? trimmed(initial.referees[1]) : "",
    2: initial.referees[2] ? trimmed(initial.referees[2]) : "",
  });

  const patch: Patch = useCallback((section, value) => {
    const next = { ...answersRef.current, [section]: { ...answersRef.current[section], ...value } } as LeaderAnswers;
    answersRef.current = next;
    setAnswers(next);
    setFeedback(null);
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
    setFeedback(null);
    setDir(direction);
    setView(target);
    moves.current += 1;
    window.scrollTo({ top: 0, behavior: "instant" });
    // Find your tribe is never saved as the step: the saved step stays "how you lead best"
    if (target !== "welcome" && target !== "done" && target !== "ineligible") void persist(savedStep(target));
    if (target === FIT_VIEW) void enterFit(direction);
  }

  /**
   * Opens Find your tribe. The comparison reads what is saved, so the saves are finished first. If there is nothing to choose
   * (no model yet, no tribe with a signed-off card, or the switch has been turned off) the leader is passed over it in the
   * direction they were going and never sees an empty screen.
   */
  async function enterFit(direction: "forward" | "back") {
    const turn = ++moves.current;
    setFitStatus("loading");
    setFitError(null);
    await saveChain.current;
    const id = appIdRef.current;
    if (!id) return;
    const result = await runFitAction(id);
    if (moves.current !== turn) return;
    if (!result.ok) {
      setFitError(result.message);
      setFitStatus("failed");
      return;
    }
    if (result.state === "none" || !result.view) {
      setFitStatus("idle");
      setFitView(null);
      return go(direction === "forward" ? (reviewMode ? "review" : viewAfter(FIT_VIEW, modes, true)) : "lead-best", direction);
    }
    const choice = result.view.choice;
    setFitView(result.view);
    setFitGoal(choice?.goalId ?? null);
    setFitBackups(choice ? choice.backups.map((b) => b.goalId) : []);
    setFitStatus("ready");
  }

  function chooseTribe(goalId: string) {
    setFitGoal(goalId);
    // A backup cannot also be the choice
    setFitBackups((b) => b.filter((x) => x !== goalId));
    setProblem(null);
  }

  function toggleBackup(goalId: string, on: boolean) {
    setFitBackups((b) => (on ? (b.includes(goalId) || b.length >= 2 || goalId === fitGoal ? b : [...b, goalId]) : b.filter((x) => x !== goalId)));
  }

  /** Saves the choice. The tribe goes into the leader's own answers before anything else is saved, so the next save cannot undo it. */
  async function continueFromFit() {
    if (!fitGoal || !fitView) return;
    setBusy(true);
    setProblem(null);
    await saveChain.current;
    const result = await chooseFitAction(appIdRef.current!, fitGoal, fitBackups);
    setBusy(false);
    if (!result.ok) return setProblem(result.message);
    patch("calling", { community: result.calling.community, goal: result.calling.goal, goalOther: undefined });
    fitKey.current = fitInputKey(answersRef.current);
    const picked = allOptions(fitView).find((o) => o.goalId === fitGoal);
    fitChosen.current = picked ? { slug: result.calling.goal, title: picked.title } : null;
    go(reviewMode ? "review" : viewAfter(FIT_VIEW, modes, true), "forward");
  }

  async function begin() {
    setBusy(true);
    setProblem(null);
    const result = await startApplicationAction();
    setBusy(false);
    if (!result.ok) return setProblem(result.message);
    appIdRef.current = result.id;
    setAppId(result.id);
    go(activeSteps(modes)[0], "forward");
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
    go(activeSteps(modes)[0], "back");
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
    go(reviewMode ? "review" : nextStep("eligibility", modes), "forward");
  }

  async function saveReferee(slot: 1 | 2) {
    const value = referees[slot];
    // Referees are optional: an empty one is simply not added. If it was added before and is now cleared, take it off.
    if (modes.references === "optional" && isBlankReferee(value)) {
      if (!savedReferees.current[slot]) return true;
      setBusy(true);
      setProblem(null);
      const cleared = await clearRefereeAction(appIdRef.current!, slot);
      setBusy(false);
      if (!cleared.ok) {
        setProblem(cleared.message);
        return false;
      }
      savedReferees.current[slot] = "";
      return true;
    }
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
      if (result.step === "ai-consent") {
        setProblem(null);
        setConsentAgreed(false);
        setConsentPending(true);
        return;
      }
      // Find your tribe was switched on, or the answers it was based on changed: back to it, then straight on to the review
      if (result.step === FIT_VIEW) {
        setFitOn(true);
        setReviewMode(true);
        go(FIT_VIEW, "back");
        setProblem(result.message);
        return;
      }
      if (result.step && (activeSteps(modes) as readonly string[]).includes(result.step)) {
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

  /** The quick check on the written answer on screen. Returns true when the person may go on. */
  async function checkWritten(step: StepId, field: string): Promise<boolean> {
    setBusy(true);
    setProblem(null);
    await persist(step);
    const result = await checkAnswerAction(appIdRef.current!, field);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return false;
    }
    if (result.skipped || result.passes) return true;
    setFeedback({ step, note: result.note ?? "Tell us a little more here, in your own words.", triesLeft: result.triesLeft ?? 0 });
    return false;
  }

  async function agreeToNewWording() {
    setBusy(true);
    setProblem(null);
    const result = await aiConsentAction(appIdRef.current!);
    setBusy(false);
    if (!result.ok) return setProblem(result.message);
    setConsentPending(false);
    // They were sent here from Send my application: go back and send it.
    if (view === "review") void submit();
  }

  async function onContinue() {
    if (busy) return;
    if (view === "welcome") return void begin();
    if (view === "done" || view === "ineligible") return;
    if (showConsent) return void agreeToNewWording();
    if (view === "review") return void submit();
    if (view === "eligibility") return void checkEligibility();
    if (view === FIT_VIEW) return void continueFromFit();
    if (view === "ref1" || view === "ref2") {
      if (!(await saveReferee(view === "ref1" ? 1 : 2))) return;
    }
    const field = CHECKED[view as StepId];
    if (field && ai.mode === "on" && !(await checkWritten(view as StepId, field))) return;
    // Changing the community from the review means the goal must be chosen again.
    if (reviewMode && view === "community" && !canContinue("goal", answers, referees, agreed, modes)) return go("goal", "forward");
    if (reviewMode) {
      // A screen the comparison reads was changed from the review: choose a tribe again before sending
      if (fitOn && (FIT_INPUT_STEPS as readonly string[]).includes(view) && fitKey.current !== fitInputKey(answersRef.current)) return go(FIT_VIEW, "forward");
      return go("review", "forward");
    }
    go(viewAfter(view, modes, fitOn), "forward");
  }

  function onBack() {
    if (view === "welcome" || view === "done" || view === "ineligible") return;
    if (reviewMode && view !== "review") return go("review", "back");
    const prev = viewBefore(view, modes, fitOn);
    if (prev) go(prev, "back");
  }

  function onEdit(step: StepId) {
    setReviewMode(true);
    go(step, "back");
  }

  async function finishLater() {
    if (view !== "welcome" && view !== "done" && view !== "ineligible") await persist(savedStep(view));
    router.push("/lead");
  }

  if (view === "done") return <Submitted name={applicantName} firstCheck={ai.mode === "on"} modes={modes} hasReferees={!isBlankReferee(referees[1]) || !isBlankReferee(referees[2])} />;
  if (view === "ineligible") return <Ineligible failed={failed} onRestart={() => void restart()} restarting={busy} error={problem} />;

  const onWelcome = view === "welcome";
  const onFit = view === FIT_VIEW;
  // Find your tribe is a view between two steps, so everything that works from the list of steps looks at the step before it
  const stepView: StepId = onWelcome ? "eligibility" : onFit ? "lead-best" : view;
  const fills = onFit ? fitFills(modes) : shieldFills(onWelcome ? "welcome" : stepView, modes);
  const stepsHere = activeSteps(modes);
  const section = onWelcome || view === "review" ? -1 : sectionOf(stepView);
  const stepNo = onWelcome ? 0 : stepsHere.indexOf(stepView) + 1;
  const canGo = showConsent ? consentAgreed : onWelcome ? agreed : onFit ? fitStatus === "ready" && fitGoal !== null : canContinue(stepView, answers, referees, true, modes);
  const label = showConsent ? "I agree, carry on" : onWelcome ? "I agree, start my application" : view === "review" ? "Send my application" : "Continue";
  const caption = onWelcome ? "About fifteen minutes" : view === "review" ? "Last step" : `${SECTIONS[section]?.label ?? ""} · ${timeLeftLabel(view, modes, fitOn).toLowerCase()}`;
  const minWords = ai.mode === "on" ? ai.minWords : undefined;
  const c = answers.calling;
  const known = catalogue.communities.find((t) => t.slug === c.community)?.goals.find((g) => g.slug === c.goal)?.title;
  // A tribe whose card was signed off after this page was opened is not in the catalogue the page was given: use the title the leader chose
  const justChosen = fitChosen.current && fitChosen.current.slug === c.goal ? fitChosen.current.title : null;
  const goalTitle = known ?? justChosen ?? c.goalOther?.trim() ?? null;

  const setReferee = (slot: 1 | 2) => (next: RefereeInput) => setReferees((r) => ({ ...r, [slot]: next }));

  return (
    <FlowFrame
      fills={fills}
      section={section}
      sections={SECTIONS}
      saveState={saveState}
      caption={caption}
      announce={onWelcome ? "Welcome" : onFit ? "Find your tribe" : `Question ${stepNo} of ${stepsHere.length}`}
      progressLabel="Application progress"
      onWelcome={onWelcome}
      leaveHref="/lead"
      leaveLabel="Leave the application"
      onFinishLater={() => void finishLater()}
      complete={view === "review"}
      viewKey={view}
      dir={dir}
      showBack={!onWelcome && viewBefore(view, modes, fitOn) !== null}
      onBack={onBack}
      onContinue={() => void onContinue()}
      primaryLabel={label}
      canGo={canGo}
      busy={busy}
      problem={problem && view !== "review" && view !== "ref1" && view !== "ref2" && !(onFit && fitStatus !== "ready") ? problem : null}
    >
      {showConsent ? <AiConsentStep text={ai.updatedConsentText} agreed={consentAgreed} onAgree={setConsentAgreed} /> : null}
      {view === "welcome" ? <LeaderWelcome agreed={agreed} onAgree={setAgreed} consentText={ai.consentText} modes={modes} training={training} /> : null}
      {view === "eligibility" ? <EligibilityStep answers={answers} patch={patch} modes={modes} /> : null}
      {view === "contact" ? <ContactStep answers={answers} patch={patch} /> : null}
      {view === "track" ? <TrackStep answers={answers} patch={patch} tracks={catalogue.tracks} /> : null}
      {view === "community" ? <CommunityStep answers={answers} patch={patch} communities={catalogue.communities} /> : null}
      {view === "goal" ? <GoalStep answers={answers} patch={patch} communities={catalogue.communities} /> : null}
      {!showConsent && (view === "goal-story" || view === "why" || view === "walked" || view === "obstacles") ? (
        <WrittenStep
          step={view}
          answers={answers}
          patch={patch}
          goalTitle={goalTitle}
          minWords={minWords}
          feedback={feedback?.step === view ? feedback : null}
        />
      ) : null}
      {!showConsent && view === "walk" ? <WalkStep answers={answers} patch={patch} minWords={minWords} feedback={feedback?.step === view ? feedback : null} /> : null}
      {isScenarioId(view) ? <ScenarioStep id={view} answers={answers} patch={patch} seed={seed} /> : null}
      {view === "style" ? <StyleStep answers={answers} patch={patch} /> : null}
      {view === "lead-best" ? <LeadBestStep answers={answers} patch={patch} /> : null}
      {onFit ? (
        <FindTribe
          status={fitStatus}
          view={fitView}
          chosen={fitGoal}
          backups={fitBackups}
          onChoose={chooseTribe}
          onBackup={toggleBackup}
          onRetry={() => void enterFit("forward")}
          error={fitError ?? problem}
        />
      ) : null}
      {view === "ref1" ? (
        <RefereeStep slot={1} value={referees[1] ?? EMPTY_REFEREE} onChange={setReferee(1)} headNeeded={false} error={problem} optional={modes.references === "optional"} />
      ) : null}
      {view === "ref2" ? (
        <RefereeStep slot={2} value={referees[2] ?? EMPTY_REFEREE} onChange={setReferee(2)} headNeeded={!(referees[1]?.head)} error={problem} optional={modes.references === "optional"} />
      ) : null}
      {!showConsent && view === "review" ? <ReviewStep answers={answers} referees={referees} catalogue={catalogue} onEdit={onEdit} error={problem} modes={modes} goalFallback={justChosen} /> : null}
    </FlowFrame>
  );
}

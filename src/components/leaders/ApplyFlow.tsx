"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlowFrame, type SaveState } from "@/components/flow/FlowFrame";
import { createClient } from "@/lib/supabase/browser";
import {
  aiConsentAction,
  checkAnswerAction,
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

export type View = "welcome" | StepId | "ineligible" | "done";

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

export function ApplyFlow({ personId, applicationId, catalogue, applicantName, ai, initial }: ApplyProps) {
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

  const showConsent = ai.mode === "on" && consentPending && (view === "review" || view in CHECKED);

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
      if (result.step === "ai-consent") {
        setProblem(null);
        setConsentAgreed(false);
        setConsentPending(true);
        return;
      }
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
    if (view === "ref1" || view === "ref2") {
      if (!(await saveReferee(view === "ref1" ? 1 : 2))) return;
    }
    const field = CHECKED[view as StepId];
    if (field && ai.mode === "on" && !(await checkWritten(view as StepId, field))) return;
    // Changing the community from the review means the goal must be chosen again.
    if (reviewMode && view === "community" && !canContinue("goal", answers, referees, agreed)) return go("goal", "forward");
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

  if (view === "done") return <Submitted name={applicantName} firstCheck={ai.mode === "on"} />;
  if (view === "ineligible") return <Ineligible failed={failed} onRestart={() => void restart()} restarting={busy} error={problem} />;

  const onWelcome = view === "welcome";
  const fills = shieldFills(view);
  const section = onWelcome || view === "review" ? -1 : sectionOf(view);
  const stepNo = onWelcome ? 0 : STEP_IDS.indexOf(view) + 1;
  const canGo = showConsent ? consentAgreed : onWelcome ? agreed : canContinue(view, answers, referees, true);
  const label = showConsent ? "I agree, carry on" : onWelcome ? "I agree, start my application" : view === "review" ? "Send my application" : "Continue";
  const caption = onWelcome ? "About fifteen minutes" : view === "review" ? "Last step" : `${SECTIONS[section]?.label ?? ""} · ${timeLeftLabel(view).toLowerCase()}`;
  const minWords = ai.mode === "on" ? ai.minWords : undefined;
  const c = answers.calling;
  const goalTitle = catalogue.communities.find((t) => t.slug === c.community)?.goals.find((g) => g.slug === c.goal)?.title ?? c.goalOther?.trim() ?? null;

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
      {showConsent ? <AiConsentStep text={ai.updatedConsentText} agreed={consentAgreed} onAgree={setConsentAgreed} /> : null}
      {view === "welcome" ? <LeaderWelcome agreed={agreed} onAgree={setAgreed} consentText={ai.consentText} /> : null}
      {view === "eligibility" ? <EligibilityStep answers={answers} patch={patch} /> : null}
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
      {view === "ref1" ? (
        <RefereeStep slot={1} value={referees[1] ?? EMPTY_REFEREE} onChange={setReferee(1)} headNeeded={false} error={problem} />
      ) : null}
      {view === "ref2" ? (
        <RefereeStep slot={2} value={referees[2] ?? EMPTY_REFEREE} onChange={setReferee(2)} headNeeded={!(referees[1]?.head)} error={problem} />
      ) : null}
      {!showConsent && view === "review" ? <ReviewStep answers={answers} referees={referees} catalogue={catalogue} onEdit={onEdit} error={problem} /> : null}
    </FlowFrame>
  );
}

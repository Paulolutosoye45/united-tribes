"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlowFrame, type SaveState } from "@/components/flow/FlowFrame";
import { PRIVATE_ANSWER_KEYS, TEENS, type Answers } from "@/lib/intake/answers";
import { HEARD_FIELDS } from "@/lib/intake/heard";
import { STYLE_PAIRS } from "@/lib/intake/options";
import { successOutcome } from "@/lib/intake/success";
import { suggestTimes } from "@/lib/intake/times";
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
import { recordConsentAction, sealDraftAction, submitIntakeAction } from "@/app/(focus)/join/actions";
import { Done } from "./Done";
import { CareStep } from "./StepsCare";
import { ContactStep } from "./StepsContact";
import { HeardStep } from "./StepsHeard";
import { RhythmStep, ReviewStep, StyleStep } from "./StepsRhythm";
import { FaithStep, GoalStep, StoryStep, SuccessStep, CommunityStep } from "./StepsSeason";
import { AgeStep, GenderStep, NameStep, WhereStep } from "./StepsYou";
import type { Catalogue } from "./types";
import { useCompanion } from "./useCompanion";
import { useHeard, useSuccessDraft, useSuggestions, type KnownFacts } from "./useSuggestions";
import { Welcome } from "./Welcome";

export type View = "welcome" | StepId | "done";

export type IntakeProps = {
  personId: string;
  catalogue: Catalogue;
  aiAvailable: boolean;
  /** Whether voice notes can be turned into words (a speech service is set up). */
  voiceAvailable: boolean;
  /** The address they signed in with, shown beside the Email choice. */
  email: string | null;
  /** The church has made the phone number compulsory (the Switchboard's "WhatsApp number required" is On). Never asked of a teenager. */
  numberRequired?: boolean;
  seasonName: string | null;
  seasonStarts: string | null;
  initial: { view: View; answers: Answers; activeSeconds: number; ai: boolean; isEdit: boolean };
};

/**
 * While tribes for teens are closed, a draft never holds a teen's answers. Once they are open, a draft is kept like any
 * other (the finished form is kept too). Neither holds the private notes: those are sealed by the server (sealDraftAction)
 * and never travel in the browser's own save.
 */
function draftOf(answers: Answers, teensOpen: boolean): Answers {
  const copy = { ...answers };
  if (copy.ageRange === TEENS && !teensOpen) delete copy.ageRange;
  for (const key of PRIVATE_ANSWER_KEYS) delete copy[key];
  return copy;
}


export function IntakeFlow({ personId, catalogue, aiAvailable, voiceAvailable, email, numberRequired = false, seasonName, seasonStarts, initial }: IntakeProps) {
  const router = useRouter();
  const [view, setView] = useState<View>(initial.view);
  const [dir, setDir] = useState<"forward" | "back">("forward");
  const [answers, setAnswers] = useState<Answers>(initial.answers);
  const [ai, setAi] = useState(initial.ai);
  const [share, setShare] = useState(false);
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

  // Tribes for 13 to 17 year olds are open only when the church has opened them (the age range's track is active).
  const teensOpen = catalogue.ageRanges.find((r) => r.slug === TEENS)?.open === true;
  // The assistant is never used on a young person's words. The server refuses too; this keeps the screen honest.
  const isTeen = answers.ageRange === TEENS;
  const assistantOn = aiAvailable && ai && !isTeen;
  const sugg = useSuggestions(assistantOn);
  const heard = useHeard(assistantOn);
  const successDraft = useSuccessDraft(assistantOn);
  const privateDirty = useRef(false);

  useEffect(() => {
    stepStart.current = Date.now();
  }, []);

  // Draft the week-12 sentence when the person reaches it (and again if they change their goal or story).
  const goalSlug = answers.goal;
  const goalOwn = answers.goalOther;
  const storyText = answers.story ?? "";
  const goalName = catalogue.communities.find((t) => t.slug === answers.community)?.goals.find((g) => g.slug === goalSlug)?.title ?? null;
  const requestDraft = successDraft.request;
  useEffect(() => {
    if (view === "success") requestDraft({ story: storyText, goal: goalSlug, goalOther: goalOwn, title: goalName });
  }, [view, goalSlug, goalOwn, storyText, goalName, requestDraft]);

  const rawSet = useCallback((patch: Partial<Answers>) => {
    if (PRIVATE_ANSWER_KEYS.some((k) => k in patch)) privateDirty.current = true;
    const next = { ...answersRef.current, ...patch };
    answersRef.current = next;
    setAnswers(next);
  }, []);

  // The Companion fills in what it can and learns from every answer. `set` is the person's own tap.
  const cmp = useCompanion({ view, answers, rawSet, initialAnswers: initial.answers, catalogue, sugg, heard, assistantOn, isTeen });
  const set = cmp.set;

  // What the person has confirmed so far, so a later question is asked with more to go on.
  const confirmed: KnownFacts = { workStatus: answers.workStatus, workField: answers.workField, relationship: answers.relationship, children: answers.children };

  // Ask for goal suggestions as soon as there is a community, even one the Companion picked, so they are ready when the screen opens.
  const requestGoals = sugg.request;
  const communityNow = answers.community;
  useEffect(() => {
    if ((view === "community" || view === "goal") && communityNow) requestGoals("season_goal", storyText, communityNow, cmp.known);
  }, [view, communityNow, storyText, requestGoals, cmp.known]);

  function tick() {
    const now = Date.now();
    activeRef.current += Math.min(MAX_SECONDS_PER_STEP, (now - stepStart.current) / 1000);
    stepStart.current = now;
  }

  function persist(step: StepId): Promise<void> {
    if (initial.isEdit) return Promise.resolve();
    const snapshot = draftOf(answersRef.current, teensOpen);
    const seconds = Math.round(activeRef.current);
    saveChain.current = saveChain.current.then(async () => {
      setSaveState("saving");
      try {
        const { error } = await createClient()
          .from("intake_drafts")
          .upsert({ person_id: personId, step, answers: snapshot, active_seconds: seconds }, { onConflict: "person_id" });
        // The private notes ride separately, sealed by the server, only when they have changed.
        let sealedOk = true;
        if (!error && privateDirty.current) {
          const mine = answersRef.current;
          privateDirty.current = false;
          const sealed = await sealDraftAction({ supportChips: mine.supportChips, supportNote: mine.supportNote, leaderNote: mine.leaderNote });
          sealedOk = sealed.ok;
          if (!sealed.ok) privateDirty.current = true;
        }
        setSaveState(error || !sealedOk ? "error" : "saved");
      } catch {
        setSaveState("error");
      }
    });
    return saveChain.current;
  }

  function go(target: View, direction: "forward" | "back") {
    tick();
    // Whatever the Companion filled in on the screen being left is now the person's own.
    if (view !== "welcome" && view !== "done") cmp.accept(view);
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
    const t = sugg.get("community", story);
    if (t?.status === "ready" && t.items.length > 0) {
      out.community = { shown: t.items.map((i) => i.id), chosen: answers.community ?? null };
      const second = t.items.find((i) => i.id !== answers.community);
      if (second) out.community_second = { shown: [second.id], chosen: answers.secondCommunity ?? null };
    }
    const g = answers.community ? sugg.get("season_goal", story, answers.community) : null;
    if (g?.status === "ready" && g.items.length > 0) {
      out.season_goal = { shown: g.items.map((i) => i.id), chosen: answers.goal ?? null };
    }

    // The "We heard…" chips: what was shown, and what is still selected.
    const h = heard.get(story);
    if (h?.status === "ready") {
      const finals: Record<string, string[]> = {
        relationship: answers.relationship ? [answers.relationship] : [],
        children: answers.children ?? [],
        work_status: answers.workStatus ? [answers.workStatus] : [],
        work_field: answers.workField ? [answers.workField] : [],
      };
      for (const field of HEARD_FIELDS) {
        const shown = (h.fields[field] ?? []).map((i) => i.id);
        if (shown.length === 0) continue;
        out[field] = { shown, chosen: field === "children" ? null : (finals[field][0] ?? null), kept: shown.filter((id) => finals[field].includes(id)) };
      }
    }
    const r = sugg.get("group_roles", story);
    if (r?.status === "ready" && r.items.length > 0) {
      const shown = r.items.map((i) => i.id);
      out.group_roles = { shown, chosen: null, kept: shown.filter((id) => answers.groupRoles?.includes(id as never)) };
    }

    // The drafted sentence: kept, edited or replaced.
    if (successDraft.state.status === "ready" && successDraft.state.ai) {
      out.success_sentence = { shown: ["draft"], chosen: successOutcome(successDraft.state.text, answers.successStatement) };
    }

    // What the Companion showed and what was kept replaces the above for every question it took part in.
    Object.assign(out, cmp.ledger(answers));

    // Meeting times are suggested by plain rules, not the assistant. Recorded under their own name so they never count as assistant picks.
    const kids = (answers.children ?? []).some((c) => c === "under_12" || c === "expecting");
    const times = suggestTimes({ zone: answers.zone, mode: answers.meetingMode, work: answers.workStatus, kids }).map((s) => s.id as string);
    if (times.length > 0) out.meeting_times = { shown: times, chosen: null, kept: times.filter((id) => answers.times?.includes(id as never)) };
    return out;
  }

  async function begin() {
    setBusy(true);
    setProblem(null);
    const result = await recordConsentAction({ ai: assistantOn, share: share && !isTeen });
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
    if (view === "story") {
      sugg.request("community", answers.story ?? "");
      sugg.request("group_roles", answers.story ?? "");
      heard.request(answers.story ?? "");
    }
    // Once the "We heard…" answers are confirmed, ask again for community suggestions with them (and again for goals after the community).
    if (view === "heard") sugg.request("community", answers.story ?? "", undefined, confirmed);
    if (view === "community" && answers.community) sugg.request("season_goal", answers.story ?? "", answers.community, confirmed);
    // Changing the community from the review means the goal must be chosen again.
    if (reviewMode && view === "community" && !canContinue("goal", answers, { teensOpen, numberRequired })) return go("goal", "forward");
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
        teen={isTeen}
        companion={{ filled: cmp.filledCount, kept: cmp.kept.size }}
      />
    );
  }

  const fills = shieldFills(view);
  const section = view === "welcome" || view === "review" ? -1 : sectionOf(view);
  const stepNo = view === "welcome" ? 0 : STEP_IDS.indexOf(view) + 1;
  const onWelcome = view === "welcome";
  const goalTitle = catalogue.communities.find((t) => t.slug === answers.community)?.goals.find((g) => g.slug === answers.goal)?.title ?? null;
  const asking = assistantOn && sugg.waiting;

  const canGo = onWelcome ? agreed || false : canContinue(view as StepId, answers, { teensOpen, numberRequired });
  // While the number is compulsory the contact screen cannot be skipped (a teenager is never asked)
  const numberNeeded = numberRequired && !isTeen;
  const skipping = SKIPPABLE.includes(view as StepId) && !(view === "contact" && numberNeeded) && isEmptyStep(view as StepId, answers);
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
        <Welcome aiAvailable={aiAvailable} matching={agreed} ai={ai} onMatching={setAgreed} onAi={setAi} share={share} onShare={isTeen ? undefined : setShare} seasonName={seasonName} />
      ) : null}
      {view === "age" ? <AgeStep answers={answers} set={set} catalogue={catalogue} teensOpen={teensOpen} /> : null}
      {view === "name" ? <NameStep answers={answers} set={set} /> : null}
      {view === "gender" ? <GenderStep answers={answers} set={set} /> : null}
      {view === "where" ? <WhereStep answers={answers} set={set} /> : null}
      {view === "story" ? <StoryStep answers={answers} set={set} cmp={cmp} assistant={!aiAvailable ? "unavailable" : ai && !isTeen ? "on" : "off"} voice={voiceAvailable && !isTeen} /> : null}
      {view === "heard" ? <HeardStep answers={answers} set={set} cmp={cmp} loading={assistantOn && heard.get(answers.story ?? "")?.status === "loading"} /> : null}
      {view === "community" ? <CommunityStep answers={answers} set={set} catalogue={catalogue} cmp={cmp} loading={asking} /> : null}
      {view === "faith" ? <FaithStep answers={answers} set={set} cmp={cmp} /> : null}
      {view === "goal" ? <GoalStep answers={answers} set={set} catalogue={catalogue} cmp={cmp} loading={asking} /> : null}
      {view === "success" ? <SuccessStep answers={answers} set={set} goalTitle={goalTitle} draft={successDraft.state} cmp={cmp} /> : null}
      {view === "rhythm" ? <RhythmStep answers={answers} set={set} cmp={cmp} /> : null}
      {view === "style" ? <StyleStep answers={answers} set={set} cmp={cmp} /> : null}
      {view === "care" ? <CareStep answers={answers} set={set} assistantOn={assistantOn} cmp={cmp} /> : null}
      {view === "contact" ? <ContactStep answers={answers} set={set} email={email} numberRequired={numberNeeded} /> : null}
      {view === "review" ? <ReviewStep answers={answers} set={set} catalogue={catalogue} onEdit={onEdit} error={problem} kept={cmp.kept} /> : null}
    </FlowFrame>
  );
}

function isEmptyStep(step: StepId, a: Answers): boolean {
  if (step === "story") return !a.story?.trim();
  if (step === "heard") return !a.workStatus && !a.workField && !a.relationship && !(a.children?.length ?? 0);
  if (step === "care") return !(a.supportChips?.length ?? 0) && !a.supportNote?.trim() && !a.leaderNote?.trim() && !a.openToServing;
  if (step === "contact") return !a.phone?.trim() && a.emailOk !== false && !a.channel;
  if (step === "style") return STYLE_PAIRS.every((p) => !a[p.key]) && !(a.groupRoles?.length ?? 0);
  return false;
}

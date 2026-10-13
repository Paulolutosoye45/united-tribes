"use client";

import { useState } from "react";
import { markGuideReviewedAction, saveGuideAction } from "@/app/(app)/admin/guides/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { formatShortDate } from "@/lib/dates";
import type { Guide, GuideDraft } from "@/lib/admin/types";
import { Notice } from "./Notice";
import { useDo } from "./useDo";

function draftOf(g: Guide): GuideDraft {
  return {
    title: g.title,
    passage: g.passage,
    sermon_series: g.sermon_series ?? "",
    sermon_title: g.sermon_title ?? "",
    big_idea: g.big_idea,
    opening_question: g.opening_question,
    questions: [...g.questions] as [string, string, string],
    practice: g.practice,
    step_hint: g.step_hint,
    prayer: g.prayer,
    confession: g.confession ?? "",
    leader_tip: g.leader_tip,
    word_how: g.word_how,
    talk_how: g.talk_how,
  };
}

/** One weekly guide. Tribes read it live, so a saved edit reaches every tribe at once. */
export function GuideForm({ guide }: { guide: Guide }) {
  const d = useDo();
  const [f, setF] = useState<GuideDraft>(() => draftOf(guide));
  const readOnly = !guide.can_edit;
  const set = <K extends keyof GuideDraft>(key: K, value: GuideDraft[K]) => setF((prev) => ({ ...prev, [key]: value }));
  const setQuestion = (i: number, value: string) => setF((prev) => ({ ...prev, questions: prev.questions.map((q, n) => (n === i ? value : q)) as [string, string, string] }));
  const same = JSON.stringify(f) === JSON.stringify(draftOf(guide));

  return (
    <form
      noValidate
      aria-label={`Week ${guide.week}`}
      className="flex flex-col gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        if (!readOnly) void d.go("save", () => saveGuideAction(guide.week, f), { saved: "Saved, and marked as read. Every tribe sees it now." });
      }}
    >
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="t-body">
          {guide.reviewed_at ? (
            <>
              <Badge tone="gold">Approved</Badge> <span className="text-soft">by {guide.reviewed_by ?? "the office"}, {formatShortDate(guide.reviewed_at)}</span>
            </>
          ) : (
            <>
              <Badge tone="outline">Draft</Badge> <span className="text-soft">Nobody has read and approved this week yet.</span>
            </>
          )}
        </p>
        {guide.can_edit && same ? (
          <Button type="button" size="sm" variant={guide.reviewed_at ? "ghost" : "solid"} loading={d.busy === "review"} disabled={d.busy !== null} onClick={() => void d.go("review", () => markGuideReviewedAction(guide.week), { saved: "Marked as read and approved." })}>
            {guide.reviewed_at ? "Approve again" : "Approve as it is"}
          </Button>
        ) : null}
      </div>

      <Section title="This week" note="What members and leaders see first.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Title" value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={120} disabled={readOnly} />
          <Input label="Passage" value={f.passage} onChange={(e) => set("passage", e.target.value)} maxLength={120} disabled={readOnly} hint="A reference such as Habakkuk 2:2–3. Leaders read it from the church’s own Bible." />
          <Input label="Sermon series" optional value={f.sermon_series ?? ""} onChange={(e) => set("sermon_series", e.target.value)} maxLength={120} disabled={readOnly} hint="Shown with the sermon title." />
          <Input label="This week’s sermon" optional value={f.sermon_title ?? ""} onChange={(e) => set("sermon_title", e.target.value)} maxLength={160} disabled={readOnly} hint="Everyone in a tribe is shown it beside the week, so their questions can follow Sunday." />
        </div>
        <Textarea label="The big idea" value={f.big_idea} onChange={(e) => set("big_idea", e.target.value)} maxLength={600} disabled={readOnly} />
        <Input label="Opening question" value={f.opening_question} onChange={(e) => set("opening_question", e.target.value)} maxLength={200} disabled={readOnly} />
      </Section>

      <Section title="In the meeting" note="The 75 minutes keep the same shape every week: 10, 15, 25, 15 and 10.">
        <Textarea label="How to lead The Word (15 minutes)" value={f.word_how} onChange={(e) => set("word_how", e.target.value)} maxLength={800} disabled={readOnly} />
        <Textarea label="How to lead Talk it through (25 minutes)" value={f.talk_how} onChange={(e) => set("talk_how", e.target.value)} maxLength={800} disabled={readOnly} />
        {f.questions.map((q, i) => (
          <Input key={i} label={`Question ${i + 1}`} value={q} onChange={(e) => setQuestion(i, e.target.value)} maxLength={300} disabled={readOnly} />
        ))}
        <Textarea label="Prayer (the last ten minutes)" value={f.prayer} onChange={(e) => set("prayer", e.target.value)} maxLength={500} disabled={readOnly} />
      </Section>

      <Section title="During the week" note="What members do between meetings.">
        <Textarea label="The practice" value={f.practice} onChange={(e) => set("practice", e.target.value)} maxLength={500} disabled={readOnly} />
        <Input label="An example step (“When…, I will…”)" value={f.step_hint} onChange={(e) => set("step_hint", e.target.value)} maxLength={300} disabled={readOnly} />
        <Textarea label="The weekly confession" value={f.confession ?? ""} onChange={(e) => set("confession", e.target.value)} maxLength={300} disabled={readOnly} hint="Members read it every day this week." />
      </Section>

      <Section title="For the leader" note="Only leaders and the office see this.">
        <Textarea label="Leader tip" value={f.leader_tip} onChange={(e) => set("leader_tip", e.target.value)} maxLength={500} disabled={readOnly} />
      </Section>

      <Notice error={d.error} saved={d.saved} />
      {readOnly ? (
        <p className="t-small text-soft">You can read the guides. The pastor, directors and the admin edit them.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="md" loading={d.busy === "save"} disabled={same}>
            Save and approve
          </Button>
          <p className="t-small text-soft">Saving counts as having read this week and approving it. Messages already sent are not recalled.</p>
        </div>
      )}
    </form>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="flex flex-col gap-0.5 pb-1">
        <span className="t-heading">{title}</span>
        <span className="t-small text-soft">{note}</span>
      </legend>
      {children}
    </fieldset>
  );
}

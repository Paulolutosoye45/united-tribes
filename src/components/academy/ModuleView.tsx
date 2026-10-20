"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { submitQuizAction } from "@/app/(app)/lead/academy/actions";
import { ShieldBurst } from "@/components/flow/Celebration";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Choice } from "@/components/ui/Choice";
import type { ModuleDetail, QuizResult } from "@/lib/academy/types";

type Phase = "read" | "quiz" | "result";

export function ModuleView({ detail }: { detail: ModuleDetail }) {
  const router = useRouter();
  const { module: m, questions, progress, pass_mark: passMark } = detail;
  const [phase, setPhase] = useState<Phase>("read");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>(() => questions.map(() => null));
  const [result, setResult] = useState<QuizResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = questions[index];
  const last = index === questions.length - 1;

  function show(next: Phase) {
    setPhase(next);
    setError(null);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  async function check() {
    setBusy(true);
    setError(null);
    const response = await submitQuizAction(m.slug, answers);
    setBusy(false);
    if (!response.ok) return setError(response.message);
    setResult(response.result);
    show("result");
    router.refresh();
  }

  function again() {
    setAnswers(questions.map(() => null));
    setIndex(0);
    setResult(null);
    show("quiz");
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <Link href="/lead/academy" className="press -ml-1 inline-flex min-h-10 w-fit items-center rounded-lg px-1 text-[0.95rem] font-medium text-soft hover:text-ink">
          ← Training
        </Link>
        <div className="flex flex-wrap items-center gap-2.5">
          <Badge tone="outline">
            Module {m.number} of 6
          </Badge>
          <Badge tone="outline">{m.format}</Badge>
          {progress.passed ? <Badge tone="gold">Passed · {progress.best}%</Badge> : null}
        </div>
        <h1 className="t-title">{m.title}</h1>
        <p className="t-body measure text-soft">{m.outcome}</p>
      </header>

      {phase === "read" ? (
        <>
          <div className="stagger flex flex-col gap-4">
            {m.lesson.map((section, i) => (
              <section key={section.title} style={{ ["--i" as string]: i }} className="card flex flex-col gap-3 p-5 sm:p-7" aria-labelledby={`s-${i}`}>
                <h2 id={`s-${i}`} className="t-heading">
                  {section.title}
                </h2>
                {section.body?.map((p) => (
                  <p key={p} className="t-body measure">
                    {p}
                  </p>
                ))}
                {section.points?.length ? (
                  <ul className="flex flex-col gap-2">
                    {section.points.map((p) => (
                      <li key={p} className="t-body measure flex gap-3">
                        <span aria-hidden="true" className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-flame" />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
            {m.practice ? (
              <aside style={{ ["--i" as string]: m.lesson.length }} className="rounded-[var(--radius-card)] border-[1.5px] border-dashed border-line bg-surface p-5 sm:p-6">
                <p className="t-small font-semibold">Try this before you move on</p>
                <p className="t-body mt-1 measure">{m.practice}</p>
              </aside>
            ) : null}
          </div>

          <div className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7">
            <div>
              <h2 className="t-heading">The quiz</h2>
              <p className="t-small text-soft">
                {questions.length} questions. {passMark}% passes. You can read the lesson again whenever you like.
              </p>
            </div>
            {detail.can_take ? (
              <Button size="lg" onClick={() => show("quiz")} className="sm:px-8">
                {progress.attempts > 0 ? "Take it again" : "Start the quiz"}
              </Button>
            ) : (
              <p className="t-small text-soft" data-testid="module-preview">
                {detail.mode === "off"
                  ? "The Academy is switched off, so leaders cannot take this module right now. You can read it."
                  : "You are previewing this module. Only leaders in training take the quiz."}
              </p>
            )}
          </div>
        </>
      ) : null}

      {phase === "quiz" && q ? (
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (answers[index] === null) return;
            if (last) void check();
            else setIndex(index + 1);
          }}
        >
          <div className="flex items-center gap-3" role="progressbar" aria-label="Quiz progress" aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={index + 1}>
            <div className="flex flex-1 gap-1.5">
              {questions.map((_, i) => (
                <span key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                  <span
                    className="block h-full origin-left rounded-full bg-flame transition-transform duration-500 [transition-timing-function:var(--ease-out)]"
                    style={{ transform: `scaleX(${i < index ? 1 : i === index ? 0.5 : 0})` }}
                  />
                </span>
              ))}
            </div>
            <span className="t-small shrink-0 text-soft">
              {index + 1} of {questions.length}
            </span>
          </div>

          <fieldset key={q.position} className="step-forward flex flex-col gap-4">
            <legend className="t-question mb-1">{q.prompt}</legend>
            <div className="stagger flex flex-col gap-3">
              {q.options.map((option, i) => (
                <Choice
                  key={option}
                  style={{ ["--i" as string]: i }}
                  name={`q-${q.position}`}
                  value={String(i)}
                  checked={answers[index] === i}
                  onChange={() => setAnswers((a) => a.map((x, k) => (k === index ? i : x)))}
                  title={option}
                />
              ))}
            </div>
          </fieldset>

          {error ? (
            <p role="alert" className="rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-[0.95rem] text-danger">
              {error}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <Button type="button" variant="quiet" size="lg" onClick={() => (index === 0 ? show("read") : setIndex(index - 1))}>
              {index === 0 ? "Back to reading" : "Back"}
            </Button>
            <Button type="submit" size="lg" fullWidth loading={busy} disabled={answers[index] === null}>
              {last ? "Check my answers" : "Next"}
            </Button>
          </div>
        </form>
      ) : null}

      {phase === "result" && result ? (
        <div className="flex flex-col gap-6">
          <section className="night rise-in flex flex-col items-center gap-5 rounded-[var(--radius-sheet)] p-8 text-center sm:p-10" aria-live="polite">
            {result.passed ? <ShieldBurst label="Module passed" /> : null}
            <h2 className="t-title">{result.passed ? "Passed." : "Not quite yet."}</h2>
            <p className="t-body max-w-[28rem] text-white/80">
              You got {result.right} of {result.total} right: {result.score}%.{" "}
              {result.passed ? "Well done." : `You need ${passMark}% to pass. Read the notes below, then try again.`}
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              {result.passed ? (
                detail.next ? (
                  <Link href={`/lead/academy/${detail.next}`} className={buttonClasses({ className: "px-8" })}>
                    <span className="relative">Next module</span>
                  </Link>
                ) : (
                  <Link href="/lead/academy" className={buttonClasses({ className: "px-8" })}>
                    <span className="relative">Back to my training</span>
                  </Link>
                )
              ) : (
                <>
                  <Button onClick={again}>Try again</Button>
                  <Button variant="night" onClick={() => show("read")}>
                    Read the lesson again
                  </Button>
                </>
              )}
            </div>
          </section>

          {result.results.some((r) => !r.right) ? (
            <section aria-labelledby="missed-heading" className="flex flex-col gap-3">
              <h2 id="missed-heading" className="t-heading">
                {result.passed ? "Worth another look" : "What to look at"}
              </h2>
              <ul className="flex flex-col gap-3">
                {result.results
                  .filter((r) => !r.right)
                  .map((r) => {
                    const question = questions.find((x) => x.position === r.position);
                    const chosen = answers[r.position - 1];
                    return (
                      <li key={r.position} className="card flex flex-col gap-2 p-5">
                        <p className="font-semibold leading-snug">{question?.prompt}</p>
                        {chosen !== null && chosen !== undefined && question ? (
                          <p className="t-small text-soft">You chose: {question.options[chosen]}</p>
                        ) : null}
                        <p className="t-body">{r.explanation}</p>
                      </li>
                    );
                  })}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

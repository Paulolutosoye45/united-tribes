"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { askPersonAction, updateAnswersAction } from "@/app/(app)/lead/update/actions";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { FIELD_INFO, MAX_ANSWER_LENGTH, type WrittenField } from "@/lib/leaders/quality/fields";
import { countWords } from "@/lib/leaders/quality/text";
import { AnswerFeedback } from "./ApplySteps";

type Item = { field: WrittenField; note: string; current: string };

/**
 * The answers the first check asked the applicant to add to. Each one shows the kind note, with the answer ready to
 * edit. Only answers that have changed are sent. They get the same quick check as on the apply screens, so an answer
 * cannot be swapped for filler here either.
 */
export function UpdateAnswers({
  appId,
  items,
  minWords,
  rewritesLeft,
  lockedUntil,
}: {
  appId: string;
  items: Item[];
  minWords: number;
  rewritesLeft: number;
  /** Set when the next update is not open yet: a short gap between updates, or none left. */
  lockedUntil?: string | null;
}) {
  const router = useRouter();
  const [text, setText] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.field, i.current])));
  const [feedback, setFeedback] = useState<Partial<Record<WrittenField, { note: string; triesLeft: number }>>>({});
  const [busy, setBusy] = useState<"send" | "person" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const locked = rewritesLeft <= 0 || Boolean(lockedUntil);
  const changed = items.filter((i) => text[i.field].trim() !== i.current.trim());

  async function send() {
    setBusy("send");
    setError(null);
    setFeedback({});
    const result = await updateAnswersAction(appId, Object.fromEntries(changed.map((i) => [i.field, text[i.field]])));
    setBusy(null);
    if (!result.ok) return setError(result.message);
    if (!result.done) return setFeedback(result.notes ?? {});
    router.push("/lead");
    router.refresh();
  }

  async function askPerson() {
    setBusy("person");
    setError(null);
    const result = await askPersonAction(appId);
    setBusy(null);
    if (!result.ok) return setError(result.message);
    router.push("/lead");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      <ul className="flex flex-col gap-8">
        {items.map((item) => {
          const info = FIELD_INFO[item.field];
          const words = countWords(text[item.field]);
          const togo = Math.max(0, minWords - words);
          return (
            <li key={item.field} className="flex flex-col gap-3">
              <p className="rounded-[var(--radius-control)] border-[1.5px] border-gold bg-gold/20 px-4 py-3 text-[0.95rem]" data-testid="update-note">
                {item.note}
              </p>
              <Textarea
                label={info.label}
                name={item.field}
                rows={6}
                maxLength={MAX_ANSWER_LENGTH[item.field]}
                value={text[item.field]}
                onChange={(e) => {
                  setText((t) => ({ ...t, [item.field]: e.target.value }));
                  setFeedback((f) => ({ ...f, [item.field]: undefined }));
                }}
                className="min-h-40 text-[1.05rem]"
                hint={togo > 0 ? `${togo} more ${togo === 1 ? "word" : "words"} to go` : "That’s enough. Add more if you like."}
              />
              {feedback[item.field] ? <AnswerFeedback {...feedback[item.field]!} again="Change it and press Send again." /> : null}
            </li>
          );
        })}
      </ul>

      {error ? (
        <p role="alert" className="t-small text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" className="px-8" disabled={locked || changed.length === 0 || busy !== null} loading={busy === "send"} onClick={() => void send()}>
            Send my update
          </Button>
          <Link href="/lead" className={buttonClasses({ variant: "quiet", size: "md" })}>
            <span className="relative">Not now</span>
          </Link>
        </div>
        <p className="t-small text-soft">
          {rewritesLeft <= 0
            ? "You have used your updates. A person reads your application next."
            : lockedUntil
              ? `You can add to your answers again from ${lockedUntil}.`
              : rewritesLeft > 1
                ? `You can add to your answers ${rewritesLeft} more times.`
                : "This is your last chance to add to your answers. After this a person reads your application."}
        </p>
      </div>

      <section className="card flex flex-col gap-3 p-5" aria-labelledby="person-heading">
        <h2 id="person-heading" className="t-heading">
          Rather have a person read it as it is?
        </h2>
        <p className="t-small text-soft">
          That is always fine. A pastor or coach will read your application exactly as you wrote it. It can take a few days, and your referees’ links open once they have.
        </p>
        {asking ? (
          <div className="flex flex-wrap gap-3">
            <Button variant="solid" size="md" loading={busy === "person"} disabled={busy !== null} onClick={() => void askPerson()}>
              Yes, a person can read it
            </Button>
            <Button variant="ghost" size="md" onClick={() => setAsking(false)}>
              Keep editing
            </Button>
          </div>
        ) : (
          <div>
            <Button variant="quiet" size="md" onClick={() => setAsking(true)}>
              Hand it to a person
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

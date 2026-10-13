"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { chooseTribeAction } from "@/app/(app)/tribe/actions";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { ShownTribe } from "@/lib/matching/types";
import { AGREEMENT_SENTENCE, COVENANT_PROMISES, LABELS, whenLine, whereLine } from "@/lib/matching/wording";
import { SuccessPicture } from "./SuccessPicture";

/** The last step: read the Success Picture and the Covenant, agree, and the seat is yours. */
export function ChooseForm({ shown }: { shown: ShownTribe }) {
  const router = useRouter();
  const c = shown.tribe;
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setBusy(true);
    setError(null);
    const result = await chooseTribeAction(c.id, agreed);
    if (!result.ok) {
      setBusy(false);
      return setError(result.message);
    }
    router.replace("/tribe?joined=1");
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <Link href="/tribe" className="press -ml-1 w-fit rounded-lg px-1 py-1 text-[0.95rem] font-medium text-soft hover:text-ink">
          ← Your tribes
        </Link>
        <h1 className="t-title">Join {c.name}</h1>
        <p className="t-body measure text-soft">
          {shown.degree}% compatible, {LABELS[shown.label].text.toLowerCase()}. {c.leader_first_name} leads it, meeting {whenLine(c)}. {whereLine(c)}.
        </p>
      </header>

      <section aria-labelledby="picture-heading" className="card flex flex-col gap-4 p-5 sm:p-7">
        <div className="flex flex-col gap-1">
          <h2 id="picture-heading" className="t-heading">
            The Success Picture
          </h2>
          <p className="t-small text-soft">What this tribe is working toward by week 12. In week 1 you will refine it together.</p>
        </div>
        <SuccessPicture god={c.god} others={c.others} life={c.life} />
      </section>

      <section aria-labelledby="covenant-heading" className="card flex flex-col gap-4 p-5 sm:p-7">
        <h2 id="covenant-heading" className="t-heading">
          The Tribe Covenant
        </h2>
        <ol className="flex flex-col gap-3">
          {COVENANT_PROMISES.map((p, i) => (
            <li key={p} className="t-body flex gap-3.5">
              <span aria-hidden="true" className="t-small mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-strong font-bold">
                {i + 1}
              </span>
              <span>{p}</span>
            </li>
          ))}
        </ol>
      </section>

      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (agreed) void join();
        }}
      >
        <label className={cn("card flex cursor-pointer items-start gap-3.5 p-5", agreed && "border-ink")}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[var(--crest-flame)]" />
          <span className="t-body">{AGREEMENT_SENTENCE}</span>
        </label>
        {error ? (
          <p role="alert" className="rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-[0.95rem] text-danger">
            {error}{" "}
            <Link href="/tribe" className="font-semibold underline underline-offset-4">
              See your tribes again
            </Link>
          </p>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="submit" size="lg" loading={busy} disabled={!agreed} className="sm:px-10">
            Join this tribe
          </Button>
          <Link href="/tribe" className="btn-quiet inline-flex h-14 items-center justify-center rounded-[var(--radius-control)] px-6 font-medium">
            Back to my tribes
          </Link>
        </div>
      </form>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signDeclarationAction } from "@/app/(app)/lead/academy/actions";
import { ShieldBurst } from "@/components/flow/Celebration";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SAFEGUARDING_PROMISES } from "@/lib/academy/declaration";

export function DeclarationForm({ signed, defaultName }: { signed: { signed_at: string } | null; defaultName: string }) {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const clean = name.replace(/\s+/g, " ").trim();
  const ready = agreed && clean.length >= 3 && clean.includes(" ");

  async function sign() {
    setBusy(true);
    setError(null);
    const result = await signDeclarationAction(clean);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setDone(true);
    router.refresh();
  }

  if (done || signed) {
    return (
      <section className="night rise-in flex flex-col items-center gap-5 rounded-[var(--radius-sheet)] p-8 text-center sm:p-10">
        {done ? <ShieldBurst label="Declaration signed" /> : null}
        <h2 className="t-title">{done ? "Signed. Thank you." : "You have signed."}</h2>
        <p className="t-body max-w-[28rem] text-white/80">These promises protect the people in your Tribe, and you. Your coach has the same words.</p>
        <Link href="/lead/academy" className={buttonClasses({ className: "px-8" })}>
          <span className="relative">Back to my training</span>
        </Link>
      </section>
    );
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) void sign();
      }}
    >
      <ol className="stagger card flex flex-col gap-4 p-5 sm:p-7">
        {SAFEGUARDING_PROMISES.map((promise, i) => (
          <li key={promise} style={{ ["--i" as string]: i }} className="t-body flex gap-3.5">
            <span aria-hidden="true" className="t-small mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-strong font-bold">
              {i + 1}
            </span>
            <span>{promise}</span>
          </li>
        ))}
      </ol>

      <label className="card flex cursor-pointer items-start gap-3.5 p-5">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[var(--crest-flame)]" />
        <span className="t-body">I have read these eight promises, and I make them.</span>
      </label>

      <Input
        label="Type your first and last name to sign"
        name="signature"
        autoComplete="name"
        value={name}
        placeholder={defaultName || "e.g. Tola Adeyemi"}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
        error={error}
      />

      <div>
        <Button type="submit" size="lg" loading={busy} disabled={!ready} className="sm:px-10">
          Sign the declaration
        </Button>
      </div>
    </form>
  );
}

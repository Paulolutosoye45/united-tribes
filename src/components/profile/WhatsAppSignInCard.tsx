"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { UserAttributes } from "@supabase/supabase-js";
import { Button } from "@/components/ui/Button";
import { CodeInput } from "@/components/ui/CodeInput";
import { Input } from "@/components/ui/Input";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";
import { maskPhone, normalisePhone, phoneDigits, whatsappErrorMessage } from "@/lib/auth/phone";
import { createClient } from "@/lib/supabase/browser";

const RESEND_SECONDS = 30;

type Step = "idle" | "number" | "code" | "done";
type Busy = null | "send" | "verify";

/**
 * Add or change the WhatsApp number used to sign in. A code is sent to the
 * new number and must be typed back before it counts, so nobody can link a
 * number that is not theirs. The number lives with the sign-in service; it is
 * not copied into the member's answers and is never shown to a leader.
 */
export function WhatsAppSignInCard({ linked }: { linked: string | null }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");
  const [input, setInput] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [numberError, setNumberError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function sendCode() {
    setError(null);
    setNumberError(null);
    const e164 = phone ?? normalisePhone(input);
    if (!e164) {
      setNumberError("That number doesn't look right. Include your network code, like 0803 123 4567.");
      return;
    }
    if (linked && phoneDigits(linked) === phoneDigits(e164)) {
      setNumberError("That is already the number on your account.");
      return;
    }
    setBusy("send");
    // `channel` is passed on to the sign-in service, which uses it to choose WhatsApp over text.
    const { error: failure } = await createClient().auth.updateUser({ phone: e164, channel: "whatsapp" } as UserAttributes);
    setBusy(null);
    if (failure) {
      setError(whatsappErrorMessage(failure));
      return;
    }
    setPhone(e164);
    setCode("");
    setStep("code");
    setCooldown(RESEND_SECONDS);
  }

  async function verify(token: string) {
    if (busy === "verify" || !phone) return;
    setError(null);
    setBusy("verify");
    const { error: failure } = await createClient().auth.verifyOtp({ phone, token, type: "phone_change" });
    if (failure) {
      setError(whatsappErrorMessage(failure));
      setCode("");
      setBusy(null);
      return;
    }
    setBusy(null);
    setStep("done");
    router.refresh();
  }

  function reset() {
    setStep("idle");
    setInput("");
    setPhone(null);
    setCode("");
    setError(null);
    setNumberError(null);
  }

  const shown = maskPhone(phone ?? linked ?? "");

  return (
    <section aria-labelledby="signin-heading" className="flex flex-col gap-4">
      <h2 id="signin-heading" className="t-heading">
        How you sign in
      </h2>
      <div className="card flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gold/25 text-ink">
            <WhatsAppIcon />
          </span>
          <div className="max-w-[52ch]">
            <p className="font-semibold">WhatsApp code</p>
            <p className="t-small text-soft">
              {shown && (step === "done" || linked)
                ? `You can sign in with a code sent to ${shown} on WhatsApp.`
                : "Add your number to sign in with a code sent on WhatsApp."}{" "}
              Only the sign-in service holds it. It is never shown to your leader or your circle.
            </p>
          </div>
        </div>

        {step === "done" ? (
          <p role="status" className="pop-in rounded-[var(--radius-control)] bg-gold/25 px-4 py-3 font-medium">
            Done. Your WhatsApp number is added.
          </p>
        ) : null}

        {step === "idle" || step === "done" ? (
          <div>
            <Button
              variant="quiet"
              size="md"
              onClick={() => {
                setStep("number");
              }}
            >
              {linked || step === "done" ? "Change number" : "Add my WhatsApp number"}
            </Button>
          </div>
        ) : null}

        {step === "number" ? (
          <form
            noValidate
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void sendCode();
            }}
          >
            <Input
              label="WhatsApp number"
              type="tel"
              name="signin-whatsapp"
              inputMode="tel"
              autoComplete="tel"
              placeholder="0803 123 4567"
              hint="We send a six-digit code to this number to check it is yours."
              value={input}
              error={numberError}
              onChange={(e) => {
                setInput(e.target.value);
                if (numberError) setNumberError(null);
              }}
              autoFocus
            />
            <div aria-live="polite" className="min-h-5">
              {error ? (
                <p role="alert" className="t-small text-danger">
                  {error}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" size="md" loading={busy === "send"}>
                Send me a code
              </Button>
              <Button type="button" variant="ghost" size="md" onClick={reset}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        {step === "code" && phone ? (
          <div className="flex flex-col gap-4">
            <p className="t-body">
              We sent a six-digit code to <strong className="font-semibold">{maskPhone(phone)}</strong> on WhatsApp.
            </p>
            <CodeInput
              value={code}
              onChange={(v) => {
                setCode(v);
                if (error) setError(null);
              }}
              onComplete={verify}
              error={Boolean(error)}
              disabled={busy === "verify"}
              autoFocus
            />
            <div aria-live="polite" className="min-h-6">
              {error ? (
                <p role="alert" className="t-small text-danger">
                  {error}
                </p>
              ) : busy === "verify" ? (
                <p className="t-small text-soft">Checking your code…</p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-3">
              <Button size="md" loading={busy === "verify"} disabled={code.length !== 6} onClick={() => verify(code)}>
                Add this number
              </Button>
              <Button variant="ghost" size="md" disabled={cooldown > 0 || busy === "send"} loading={busy === "send"} onClick={sendCode}>
                {cooldown > 0 ? `Send a new code in ${cooldown}s` : "Send a new code"}
              </Button>
              <Button variant="ghost" size="md" onClick={reset}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

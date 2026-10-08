"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CodeInput } from "@/components/ui/CodeInput";
import { Input } from "@/components/ui/Input";
import { displayPhone, isUnknownAccount, maskPhone, normalisePhone, whatsappErrorMessage } from "@/lib/auth/phone";
import { createClient } from "@/lib/supabase/browser";

const RESEND_SECONDS = 30;

type Busy = null | "send" | "verify";

/**
 * Sign in with a six-digit code sent on WhatsApp. Only for people who have
 * already added their number to their account, so one person never ends up
 * with two accounts and loses their circle.
 */
export function WhatsAppSignIn({ next, onBack }: { next: string; onBack: () => void }) {
  const [step, setStep] = useState<"number" | "code">("number");
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
    setBusy("send");
    const { error: failure } = await createClient().auth.signInWithOtp({
      phone: e164,
      options: { channel: "whatsapp", shouldCreateUser: false },
    });
    setBusy(null);
    if (failure && !isUnknownAccount(failure)) {
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
    const supabase = createClient();
    const { error: failure } = await supabase.auth.verifyOtp({ phone, token, type: "sms" });
    if (failure) {
      setError(whatsappErrorMessage(failure));
      setCode("");
      setBusy(null);
      return;
    }
    try {
      await supabase.rpc("claim_invitations");
    } catch {
      // Roles are claimed again on the next sign-in.
    }
    window.location.assign(next);
  }

  if (step === "code" && phone) {
    return (
      <div className="screen-enter flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h2 className="t-title">Check WhatsApp</h2>
          <p className="t-body text-soft">
            We sent a six-digit code to <strong className="font-semibold text-ink">{maskPhone(phone)}</strong> on WhatsApp. Enter it here.
          </p>
        </div>

        <div className="flex flex-col gap-3">
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
        </div>

        <Button size="lg" fullWidth loading={busy === "verify"} disabled={code.length !== 6} onClick={() => verify(code)}>
          Sign in
        </Button>

        <p className="t-small text-soft">
          Nothing arrived? WhatsApp sign-in works once your number is added to your account. Sign in with Google or email first,
          then add it under <strong className="font-semibold text-ink">Privacy and my data</strong>.
        </p>

        <div className="flex flex-col items-start gap-1">
          <Button
            variant="ghost"
            size="md"
            className="-ml-4"
            disabled={cooldown > 0 || busy === "send"}
            loading={busy === "send"}
            onClick={sendCode}
          >
            {cooldown > 0 ? `Send a new code in ${cooldown}s` : "Send a new code"}
          </Button>
          <Button
            variant="ghost"
            size="md"
            className="-ml-4"
            onClick={() => {
              setStep("number");
              setPhone(null);
              setError(null);
              setCode("");
            }}
          >
            Use a different number
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-enter flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <h2 className="t-title">Sign in with WhatsApp</h2>
        <p className="t-body text-soft">We send a six-digit code to the WhatsApp number on your account.</p>
      </div>

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
          name="whatsapp"
          inputMode="tel"
          autoComplete="tel"
          placeholder="0803 123 4567"
          hint={input && normalisePhone(input) ? displayPhone(normalisePhone(input) ?? "") : "Nigerian numbers can start with 0. Other countries start with +."}
          value={input}
          error={numberError}
          onChange={(e) => {
            setInput(e.target.value);
            if (numberError) setNumberError(null);
          }}
          autoFocus
        />
        <Button type="submit" size="lg" fullWidth loading={busy === "send"}>
          Send me a code
        </Button>
        <div aria-live="polite" className="min-h-5">
          {error ? (
            <p role="alert" className="t-small text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </form>

      <Button variant="ghost" size="md" className="-ml-4 self-start" onClick={onBack}>
        Use another way to sign in
      </Button>
    </div>
  );
}

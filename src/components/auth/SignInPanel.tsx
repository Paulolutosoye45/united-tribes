"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CodeInput } from "@/components/ui/CodeInput";
import { GoogleIcon } from "@/components/ui/GoogleIcon";
import { Input } from "@/components/ui/Input";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";
import { isEmail, normaliseEmail, signInErrorMessage } from "@/lib/auth/errors";
import { createClient } from "@/lib/supabase/browser";
import { useTurnstile } from "@/components/security/Turnstile";
import { WhatsAppSignIn } from "./WhatsAppSignIn";

type Props = {
  /** Where to go after signing in. Already checked on the server. */
  next: string;
  initialError?: string | null;
  /** Offer a code on WhatsApp. Off until the sign-in service can send one. */
  whatsapp?: boolean;
};

type Busy = null | "google" | "email" | "verify";

const RESEND_SECONDS = 30;

export function SignInPanel({ next, initialError = null, whatsapp = false }: Props) {
  const [step, setStep] = useState<"choose" | "code" | "whatsapp">("choose");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const bot = useTurnstile();

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const callback = (path: string) =>
    `${window.location.origin}${path}?next=${encodeURIComponent(next)}`;

  async function continueWithGoogle() {
    setError(null);
    setBusy("google");
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback("/auth/callback") },
    });
    // On success the browser leaves for Google, so only failures return here.
    if (error) {
      setError(signInErrorMessage(error));
      setBusy(null);
    }
  }

  async function sendCode() {
    setError(null);
    setEmailError(null);
    if (!isEmail(email)) {
      setEmailError("Enter the email address you check most often.");
      return;
    }
    if (!bot.ready) {
      setError("One moment: we are checking that you are a person. Try again in a few seconds.");
      return;
    }
    setBusy("email");
    const { error } = await createClient().auth.signInWithOtp({
      email: normaliseEmail(email),
      options: { shouldCreateUser: true, emailRedirectTo: callback("/auth/confirm"), captchaToken: bot.token ?? undefined },
    });
    bot.spent();
    setBusy(null);
    if (error) {
      setError(signInErrorMessage(error));
      return;
    }
    setCode("");
    setStep("code");
    setCooldown(RESEND_SECONDS);
  }

  async function verify(token: string) {
    if (busy === "verify") return;
    setError(null);
    setBusy("verify");
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      email: normaliseEmail(email),
      token,
      type: "email",
    });
    if (error) {
      setError(signInErrorMessage(error));
      setCode("");
      setBusy(null);
      return;
    }
    // Turn any invitation for this address into a role, then load the app
    // fresh so the server sees the new session.
    try {
      await supabase.rpc("claim_invitations");
    } catch {
      // Roles are claimed again on the next sign-in.
    }
    window.location.assign(next);
  }

  if (step === "whatsapp") {
    return <WhatsAppSignIn next={next} onBack={() => setStep("choose")} />;
  }

  if (step === "code") {
    return (
      <div className="screen-enter flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h2 className="t-title">Check your email</h2>
          <p className="t-body text-soft">
            We sent a six-digit code to <strong className="font-semibold text-ink">{normaliseEmail(email)}</strong>.
            Enter it here.
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

        {bot.widget}

        <div className="flex flex-col items-start gap-1">
          <Button
            variant="ghost"
            size="md"
            className="-ml-4"
            disabled={cooldown > 0 || busy === "email" || !bot.ready}
            loading={busy === "email"}
            onClick={sendCode}
          >
            {cooldown > 0 ? `Send a new code in ${cooldown}s` : "Send a new code"}
          </Button>
          <Button
            variant="ghost"
            size="md"
            className="-ml-4"
            onClick={() => {
              setStep("choose");
              setError(null);
              setCode("");
            }}
          >
            Use a different email
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-enter flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <h2 className="t-title">Sign in</h2>
        <p className="t-body text-soft">New here? The same steps create your account.</p>
      </div>

      <div className="flex flex-col gap-5">
        <Button
          variant="quiet"
          size="lg"
          fullWidth
          loading={busy === "google"}
          icon={<GoogleIcon />}
          onClick={continueWithGoogle}
        >
          Continue with Google
        </Button>

        {whatsapp ? (
          <Button
            variant="quiet"
            size="lg"
            fullWidth
            icon={<WhatsAppIcon />}
            onClick={() => {
              setError(null);
              setStep("whatsapp");
            }}
          >
            Continue with WhatsApp
          </Button>
        ) : null}

        <div className="flex items-center gap-4 text-soft" role="separator" aria-label="or">
          <span className="h-px flex-1 bg-line" />
          <span className="t-small">or</span>
          <span className="h-px flex-1 bg-line" />
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
            label="Email address"
            type="email"
            name="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="you@example.com"
            value={email}
            error={emailError}
            onChange={(e) => {
              setEmail(e.target.value);
              if (emailError) setEmailError(null);
            }}
          />
          {bot.widget}
          <Button type="submit" size="lg" fullWidth loading={busy === "email"} disabled={!bot.ready}>
            Email me a code
          </Button>
        </form>

        <div aria-live="polite" className="min-h-5">
          {error ? (
            <p role="alert" className="t-small text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

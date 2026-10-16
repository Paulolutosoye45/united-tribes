"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { deviceOf } from "@/lib/activity/screens";
import { sendTrack } from "@/lib/activity/send";
import { GoogleIcon } from "@/components/ui/GoogleIcon";
import { Input } from "@/components/ui/Input";
import { displayPhone, whatsappErrorMessage } from "@/lib/auth/phone";
import { isEmail, normaliseEmail, signInErrorMessage } from "@/lib/auth/errors";
import { readChoice, writeChoice, type SignInTab } from "@/lib/signin/choice";
import { resendWaitSeconds } from "@/lib/signin/caps";
import type { SignInChannel } from "@/lib/signin/channel";
import { readTypedNumber, showsNigerianPrefix } from "@/lib/signin/typed-number";
import { BAD_NUMBER_LINE, NOT_ADDED_LINE, PAUSED_LINE, UNAVAILABLE_LINE } from "@/lib/signin/wording";
import { createClient } from "@/lib/supabase/browser";
import { useTurnstile } from "@/components/security/Turnstile";
import { ChannelToggle } from "./ChannelToggle";
import { EmailCodeStep, WhatsAppCodeStep } from "./CodeStep";

type Props = {
  /** Where to go after signing in. Already checked on the server. */
  next: string;
  initialError?: string | null;
  /** How WhatsApp codes stand right now. Without it (or when not available) the screen is email only, as it always was. */
  channel?: SignInChannel;
};

type Busy = null | "google" | "email" | "whatsapp" | "verify";

const EMAIL_RESEND_SECONDS = 30;
const EMAIL_ONLY: SignInChannel = { available: false, status: "off", mode: "normal", number: null };

/**
 * The sign-in screen: Google on top, then "or get a code" with an Email | WhatsApp switch, one field and one button.
 * Email can never be switched off. WhatsApp can be paused (by a person, or by the breaker); it then stays visible but
 * greyed, with one line saying why, and Email is selected.
 */
export function SignInPanel({ next, initialError = null, channel: initialChannel = EMAIL_ONLY }: Props) {
  const panelId = useId();
  const [channel, setChannel] = useState<SignInChannel>(initialChannel);
  // What they tapped on this visit; until they tap, the way they used last on this device (read after the page loads, so
  // the server's first draw and the browser's agree). A first visit has neither, and starts on Email.
  const [picked, setPicked] = useState<SignInTab | null>(null);
  const remembered = useSyncExternalStore(
    () => () => { },
    () => readChoice(),
    () => null,
  );
  const tab: SignInTab = picked ?? remembered ?? "email";
  const [step, setStep] = useState<"choose" | "code">("choose");
  const [via, setVia] = useState<SignInTab>("email");
  const [email, setEmail] = useState("");
  const [waInput, setWaInput] = useState("");
  const [waPhone, setWaPhone] = useState<string | null>(null);
  const [sent, setSent] = useState<{ phone: string; count: number } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const bot = useTurnstile();

  const whatsappOn = channel.available && channel.status === "on";
  // WhatsApp only when it is on. A remembered choice is never lost for being paused today: it is just not used.
  const active: SignInTab = tab === "whatsapp" && whatsappOn ? "whatsapp" : "email";

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const callback = (path: string) => `${window.location.origin}${path}?next=${encodeURIComponent(next)}`;

  function choose(to: SignInTab) {
    setPicked(to);
    setError(null);
    setFieldError(null);
    writeChoice(to);
  }

  function useEmailInstead() {
    setPicked("email");
    setStep("choose");
    setError(null);
    setFieldError(null);
    setCode("");
    writeChoice("email");
  }

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

  async function sendEmailCode() {
    setError(null);
    setFieldError(null);
    if (!isEmail(email)) {
      setFieldError("Enter the email address you check most often.");
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
    writeChoice("email");
    setCode("");
    setVia("email");
    setStep("code");
    setCooldown(EMAIL_RESEND_SECONDS);
  }

  async function askWhatsAppCode() {
    setError(null);
    setFieldError(null);
    const phone = waPhone ?? readTypedNumber(waInput);
    if (!phone) {
      setFieldError(BAD_NUMBER_LINE);
      return;
    }
    if (!bot.ready) {
      setError("One moment: we are checking that you are a person. Try again in a few seconds.");
      return;
    }
    setBusy("whatsapp");
    let status = 0;
    let body: { ok?: boolean; error?: string; message?: string } | null = null;
    try {
      const response = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, captchaToken: bot.token ?? undefined }),
      });
      status = response.status;
      body = await response.json().catch(() => null);
    } catch {
      status = 0;
    }
    bot.spent();
    setBusy(null);

    if (status !== 200 || body?.ok !== true) {
      // Paused or off while the page was open: grey WhatsApp out and put Email forward, so nobody is stuck on a dead tab.
      if (body?.error === "paused") setChannel((c) => ({ ...c, status: "paused" }));
      else if (body?.error === "off") setChannel((c) => ({ ...c, status: "off" }));
      else {
        const said = typeof body?.message === "string" && body.message ? body.message : status === 0 ? `${whatsappErrorMessage({ message: "Failed to fetch" })} Or use email instead.` : UNAVAILABLE_LINE;
        setError(said);
      }
      return;
    }

    writeChoice("whatsapp");
    setWaPhone(phone);
    const count = sent && sent.phone === phone ? sent.count + 1 : 1;
    setSent({ phone, count });
    setCode("");
    setVia("whatsapp");
    setStep("code");
    // The same wait the server enforces: a minute, then two, then five. Pressing the button sooner would be ignored.
    setCooldown(resendWaitSeconds(count));
  }

  async function verify(token: string) {
    if (busy === "verify") return;
    if (via === "whatsapp" && !waPhone) return;
    setError(null);
    setBusy("verify");
    const supabase = createClient();
    const { error: failure } =
      via === "whatsapp"
        ? await supabase.auth.verifyOtp({ phone: waPhone!, token, type: "sms" })
        : await supabase.auth.verifyOtp({ email: normaliseEmail(email), token, type: "email" });
    if (failure) {
      setError(via === "whatsapp" ? whatsappErrorMessage(failure) : signInErrorMessage(failure));
      setCode("");
      setBusy(null);
      return;
    }
    // Turn any invitation for this address into a role, then load the app fresh so the server sees the new session.
    try {
      await supabase.rpc("claim_invitations");
    } catch {
      // Roles are claimed again on the next sign-in.
    }
    // Tell the activity log how they came in (the way only, never the address or number). It never waits or fails.
    sendTrack({ kind: "signin", method: via === "whatsapp" ? "whatsapp" : "email", device: deviceOf(window.innerWidth) });
    window.location.assign(next);
  }

  const backToChoose = (to: SignInTab) => {
    setStep("choose");
    setError(null);
    setCode("");
    if (to === "whatsapp") setWaPhone(null);
  };

  const shared = {
    code,
    onCode: (value: string) => {
      setCode(value);
      if (error) setError(null);
    },
    onComplete: verify,
    verifying: busy === "verify",
    error,
    cooldown,
    widget: bot.widget,
    canResend: bot.ready,
  };

  if (step === "code" && via === "whatsapp" && waPhone) {
    return (
      <WhatsAppCodeStep
        {...shared}
        phone={waPhone}
        mode={channel.mode}
        number={channel.number}
        resending={busy === "whatsapp"}
        onResend={askWhatsAppCode}
        onChange={() => backToChoose("whatsapp")}
        onEmail={useEmailInstead}
      />
    );
  }

  if (step === "code") {
    return (
      <EmailCodeStep
        {...shared}
        email={normaliseEmail(email)}
        resending={busy === "email"}
        onResend={sendEmailCode}
        onChange={() => backToChoose("email")}
      />
    );
  }

  const typed = readTypedNumber(waInput);

  return (
    <div className="screen-enter flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <h2 className="t-title">Sign in</h2>
        <p className="t-body text-soft">New here? The same steps create your account.</p>
      </div>

      <div className="flex flex-col gap-5">
        <Button variant="quiet" size="lg" fullWidth loading={busy === "google"} icon={<GoogleIcon />} onClick={continueWithGoogle}>
          Continue with Google
        </Button>

        <div className="flex items-center gap-4 text-soft" role="separator" aria-label="or get a code">
          <span className="h-px flex-1 bg-line" />
          <span className="t-small">or get a code</span>
          <span className="h-px flex-1 bg-line" />
        </div>

        {channel.available ? <ChannelToggle value={active} onChange={choose} whatsappDisabled={!whatsappOn} panelId={panelId} /> : null}
        {channel.available && !whatsappOn ? (
          <p role="status" className="t-small text-soft">
            {PAUSED_LINE}
          </p>
        ) : null}

        <div
          id={panelId}
          role={channel.available ? "tabpanel" : undefined}
          aria-labelledby={channel.available ? `signin-tab-${active}` : undefined}
          className="flex flex-col gap-4"
        >
          {active === "email" ? (
            <form
              noValidate
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void sendEmailCode();
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
                error={fieldError}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (fieldError) setFieldError(null);
                }}
              />
              {bot.widget}
              <Button type="submit" size="lg" fullWidth loading={busy === "email"} disabled={!bot.ready}>
                Email me a code
              </Button>
            </form>
          ) : (
            <form
              noValidate
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void askWhatsAppCode();
              }}
            >
              <Input
                label="WhatsApp number"
                type="tel"
                name="whatsapp"
                inputMode="tel"
                autoComplete="tel"
                placeholder={showsNigerianPrefix(waInput) ? "803 123 4567" : "+44 7700 900123"}
                prefix={showsNigerianPrefix(waInput) ? "+234" : undefined}
                hint={typed ? displayPhone(typed) : "Type it the way you usually do, like 0803 123 4567. Other countries start with +."}
                value={waInput}
                error={fieldError}
                onChange={(e) => {
                  setWaInput(e.target.value);
                  if (fieldError) setFieldError(null);
                }}
              />
              {bot.widget}
              <Button type="submit" size="lg" fullWidth loading={busy === "whatsapp"} disabled={!bot.ready}>
                Send code on WhatsApp
              </Button>
              <p className="t-small text-soft">{NOT_ADDED_LINE}</p>
              {channel.mode === "reply_first" && channel.number ? (
                <p className="t-small text-soft">Your code comes as a reply: after you press the button we will ask you to send us one short message on WhatsApp.</p>
              ) : null}
              {channel.number ? (
                <p className="t-small text-soft">
                  Tip: save this number as <strong className="font-semibold text-ink">United Tribes</strong>: {displayPhone(channel.number)}.
                </p>
              ) : null}
            </form>
          )}
        </div>

        <div aria-live="polite" className="flex min-h-5 flex-col items-start gap-1">
          {error ? (
            <>
              <p role="alert" className="t-small text-danger">
                {error}
              </p>
              {active === "whatsapp" ? (
                <Button variant="ghost" size="md" className="-ml-4" onClick={useEmailInstead}>
                  Use email instead
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

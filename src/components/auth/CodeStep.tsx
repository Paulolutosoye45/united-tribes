"use client";

import type { ReactNode } from "react";
import { Button, buttonClasses } from "@/components/ui/Button";
import { CodeInput } from "@/components/ui/CodeInput";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";
import { displayPhone, maskPhone } from "@/lib/auth/phone";
import { ASK_TEXT, CODE_LIFETIME_LINE, NOT_ADDED_LINE, openWhatsAppLink } from "@/lib/signin/wording";

type Common = {
  code: string;
  onCode: (code: string) => void;
  onComplete: (code: string) => void;
  verifying: boolean;
  error: string | null;
  /** Seconds left before another code may be asked for. 0 means now. */
  cooldown: number;
  resending: boolean;
  onResend: () => void;
  /** Back to the first screen, to type a different address or number */
  onChange: () => void;
  /** The bot check, when it is on, so a new code can be asked for from this screen */
  widget?: ReactNode;
  canResend: boolean;
};

function Entry({ code, onCode, onComplete, verifying, error, autoFocus }: Pick<Common, "code" | "onCode" | "onComplete" | "verifying" | "error"> & { autoFocus: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <CodeInput
        value={code}
        onChange={(v) => onCode(v)}
        onComplete={onComplete}
        error={Boolean(error)}
        disabled={verifying}
        autoFocus={autoFocus}
      />
      <div aria-live="polite" className="min-h-6">
        {error ? (
          <p role="alert" className="t-small text-danger">
            {error}
          </p>
        ) : verifying ? (
          <p className="t-small text-soft">Checking your code…</p>
        ) : null}
      </div>
    </div>
  );
}

/** The step after an email code was sent. Unchanged in what it says and does; it shares the six boxes with the WhatsApp step. */
export function EmailCodeStep(props: Common & { email: string }) {
  const { email, code, cooldown, resending, onResend, onChange, widget, canResend } = props;
  return (
    <div className="screen-enter flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="t-title">Check your email</h2>
        <p className="t-body text-soft">
          We sent a six-digit code to <strong className="font-semibold text-ink">{email}</strong>. Enter it here.
        </p>
      </div>

      <Entry {...props} autoFocus />

      <Button size="lg" fullWidth loading={props.verifying} disabled={code.length !== 6} onClick={() => props.onComplete(code)}>
        Sign in
      </Button>

      {widget}

      <div className="flex flex-col items-start gap-1">
        <Button variant="ghost" size="md" className="-ml-4" disabled={cooldown > 0 || resending || !canResend} loading={resending} onClick={onResend}>
          {cooldown > 0 ? `Send a new code in ${cooldown}s` : "Send a new code"}
        </Button>
        <Button variant="ghost" size="md" className="-ml-4" onClick={onChange}>
          Use a different email
        </Button>
      </div>
    </div>
  );
}

/** "Open WhatsApp": a link, so it works with no script and opens the app on a phone. */
function OpenWhatsApp({ number, ask, primary }: { number: string | null; ask: boolean; primary: boolean }) {
  const href = number ? (ask ? openWhatsAppLink(number, ASK_TEXT) : `https://wa.me/${number}`) : "whatsapp://";
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={buttonClasses({ variant: primary ? "primary" : "quiet", size: "lg", fullWidth: true })}
    >
      <WhatsAppIcon />
      <span className="relative">{ask ? "Open WhatsApp and send the message" : "Open WhatsApp"}</span>
    </a>
  );
}

/**
 * The step after a WhatsApp code was asked for. Two kinds:
 *   sent         we sent the code to their WhatsApp. Open WhatsApp to read it, type it here.
 *   reply-first  we hold the code until they message our number. They send one short message, we reply with the code.
 */
export function WhatsAppCodeStep(
  props: Common & {
    phone: string;
    mode: "normal" | "reply_first";
    /** The number to save and message, digits only. Null when not set. */
    number: string | null;
    onEmail: () => void;
  },
) {
  const { phone, mode, number, code, cooldown, resending, onResend, onChange, onEmail, widget, canResend } = props;
  const replyFirst = mode === "reply_first" && number !== null;
  return (
    <div className="screen-enter flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="t-title">{replyFirst ? "Message us on WhatsApp" : "Check WhatsApp"}</h2>
        {replyFirst ? (
          <p className="t-body text-soft">
            To keep your code safe, we send it as a reply to you. Tap the button and press send on the message that is ready. We will
            answer with a six-digit code for <strong className="font-semibold text-ink">{maskPhone(phone)}</strong>. {CODE_LIFETIME_LINE}
          </p>
        ) : (
          <p className="t-body text-soft">
            We sent a six-digit code to <strong className="font-semibold text-ink">{maskPhone(phone)}</strong> on WhatsApp. Enter it here.{" "}
            {CODE_LIFETIME_LINE}
          </p>
        )}
      </div>

      <OpenWhatsApp number={number} ask={replyFirst} primary={replyFirst} />

      <Entry {...props} autoFocus={!replyFirst} />

      <Button size="lg" fullWidth loading={props.verifying} disabled={code.length !== 6} onClick={() => props.onComplete(code)}>
        Sign in
      </Button>

      {number ? (
        <p className="t-small text-soft">
          Tip: save this number as <strong className="font-semibold text-ink">United Tribes</strong>: {displayPhone(number)}. Then the message is easy to find.
        </p>
      ) : null}
      <p className="t-small text-soft">{NOT_ADDED_LINE}</p>

      {widget}

      <div className="flex flex-col items-start gap-1">
        <Button variant="ghost" size="md" className="-ml-4" disabled={cooldown > 0 || resending || !canResend} loading={resending} onClick={onResend}>
          {cooldown > 0 ? `Send a new code in ${cooldown}s` : replyFirst ? "Ask for a new code" : "Send a new code"}
        </Button>
        <Button variant="ghost" size="md" className="-ml-4" onClick={onEmail}>
          Use email instead
        </Button>
        <Button variant="ghost" size="md" className="-ml-4" onClick={onChange}>
          Use a different number
        </Button>
      </div>
    </div>
  );
}

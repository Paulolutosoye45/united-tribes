"use client";

import { useState } from "react";
import { resetSigninBreakerAction, setSigninModeAction, setSigninSwitchAction } from "@/app/(app)/admin/signin/actions";
import { Button } from "@/components/ui/Button";
import { Choice } from "@/components/ui/Choice";
import { MODE_CHOICES, SENDER_SIGNAL_LABEL, TRIP_ADVICE, tripReason, whenText, type SigninOverview } from "@/lib/signin/admin";
import { displayPhone } from "@/lib/auth/phone";
import { Notice } from "./Notice";
import { useDo } from "./useDo";

export type SigninSetup = { configured: boolean; number: string | null };

const STATUS = {
  on: { label: "On", tone: "bg-success/15 text-success", line: "People can ask for their sign-in code on WhatsApp." },
  paused: { label: "Paused", tone: "bg-flame/15 text-flame-deep", line: "WhatsApp stopped itself. People see “WhatsApp codes are paused today. Use email.” and can still sign in by email." },
  off: { label: "Switched off", tone: "bg-surface-strong text-ink", line: "No WhatsApp codes are sent. People see “WhatsApp codes are paused today. Use email.” and can still sign in by email." },
} as const;

/** The switch, the breaker, and the way of sending, with what is happening right now. */
export function SignInControls({ overview, setup }: { overview: SigninOverview; setup: SigninSetup }) {
  const d = useDo();
  const s = overview.settings;
  const status = STATUS[overview.status];
  const [note, setNote] = useState("");
  const [mode, setMode] = useState(s.mode);
  const [confirmingMode, setConfirmingMode] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);

  return (
    <section aria-labelledby="signin-status-heading" className="card flex flex-col gap-6 p-5 sm:p-6" data-testid="signin-status">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="signin-status-heading" className="t-heading">
            Right now
          </h2>
          <p className="t-small max-w-[56ch] text-soft">{status.line}</p>
        </div>
        <span data-testid="signin-status-now" className={`rounded-full px-4 py-1.5 font-semibold ${status.tone}`}>
          {status.label}
        </span>
      </div>

      {!setup.configured ? (
        <p role="note" className="t-small rounded-[var(--radius-control)] bg-gold/20 px-4 py-3">
          WhatsApp sign-in is not set up on this site yet, so people are only offered email. The switch below is ready for when it is. See docs/SIGNIN-CHANNELS.md.
        </p>
      ) : null}

      {s.breaker_state === "tripped" ? (
        <div className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-flame/10 px-4 py-4" data-testid="signin-tripped">
          <p className="font-semibold">WhatsApp paused itself{s.breaker_tripped_at ? ` on ${whenText(s.breaker_tripped_at)}` : ""}</p>
          <p className="t-small">Because {tripReason(s.breaker_reason)}.</p>
          {s.breaker_reason && TRIP_ADVICE[s.breaker_reason] ? <p className="t-small text-soft">{TRIP_ADVICE[s.breaker_reason]}</p> : null}
          <p className="t-small text-soft">It will not start again on its own. When you have looked into it, restart it here.</p>
          {confirmingReset ? (
            <div className="pop-in flex flex-col gap-3">
              <label htmlFor="signin-reset-note" className="t-small font-medium">
                A note for the log (optional): what you found
              </label>
              <input
                id="signin-reset-note"
                value={note}
                maxLength={200}
                onChange={(e) => setNote(e.target.value)}
                className="h-12 w-full rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base focus:border-ink focus:outline-none"
              />
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="solid"
                  size="md"
                  loading={d.busy === "reset"}
                  onClick={() => void d.go("reset", () => resetSigninBreakerAction(note), { saved: "WhatsApp restarted. It will pause again if the same thing happens.", after: () => setConfirmingReset(false) })}
                >
                  Restart WhatsApp codes
                </Button>
                <Button variant="ghost" size="md" onClick={() => setConfirmingReset(false)}>
                  Not yet
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <Button size="md" onClick={() => setConfirmingReset(true)}>
                I have looked into it: restart
              </Button>
            </div>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5" data-testid="signin-switch">
        <div className="flex max-w-[52ch] flex-col gap-0.5">
          <p className="font-semibold">WhatsApp codes</p>
          <p className="t-small text-soft">
            {s.whatsapp_on
              ? "The kill switch. Turning it off stops every WhatsApp code at once. Email codes carry on."
              : "Switched off. Turn it on when you are ready; if it paused itself, restart it above as well."}
          </p>
        </div>
        <Button
          variant={s.whatsapp_on ? "quiet" : "solid"}
          size="md"
          loading={d.busy === "switch"}
          onClick={() => void d.go("switch", () => setSigninSwitchAction(!s.whatsapp_on), { saved: s.whatsapp_on ? "Switched off. No more WhatsApp codes will be sent." : "Switched on." })}
        >
          {s.whatsapp_on ? "Turn WhatsApp codes off" : "Turn WhatsApp codes on"}
        </Button>
      </div>

      <div className="flex flex-col gap-4 border-t border-line pt-5" data-testid="signin-mode">
        <div className="flex flex-col gap-0.5">
          <p className="font-semibold">How the code reaches people</p>
          <p className="t-small text-soft">Only matters when an ordinary number sends the codes. The official WhatsApp Business route always sends at once.</p>
        </div>
        <div role="radiogroup" aria-label="How the code reaches people" className="flex flex-col gap-3">
          {MODE_CHOICES.map((m) => (
            <Choice
              key={m.id}
              name="signin-mode"
              value={m.id}
              checked={mode === m.id}
              onChange={() => {
                setMode(m.id);
                setConfirmingMode(false);
                d.clear();
              }}
              title={m.id === s.mode ? `${m.title} (now)` : m.title}
              description={m.body}
            />
          ))}
        </div>
        {confirmingMode ? (
          <div className="pop-in flex flex-col gap-3 rounded-[var(--radius-control)] bg-surface px-4 py-4">
            <p className="font-semibold">{mode === "normal" ? "Send codes at once?" : "Switch to reply first?"}</p>
            <p className="t-small text-soft">
              {mode === "normal"
                ? "Codes will be sent to people who have not messaged the number. That is the riskier way to use an ordinary number. This is recorded with your name."
                : "People will be asked to message the number first, and the number replies with the code. Codes waiting right now are not affected. This is recorded with your name."}
            </p>
            <div className="flex gap-3">
              <Button
                variant="solid"
                size="md"
                loading={d.busy === "mode"}
                onClick={() => void d.go("mode", () => setSigninModeAction(mode), { saved: "Saved. It applies to the next code.", after: () => setConfirmingMode(false) })}
              >
                Yes, change it
              </Button>
              <Button variant="ghost" size="md" onClick={() => setConfirmingMode(false)}>
                Not yet
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button size="md" disabled={mode === s.mode} onClick={() => setConfirmingMode(true)}>
              Change how the code is sent
            </Button>
          </div>
        )}
      </div>

      <dl className="grid gap-x-8 gap-y-3 border-t border-line pt-5 sm:grid-cols-2" data-testid="signin-now">
        <Fact term="Codes in the last hour" value={`${overview.now.hour} of ${s.cap_channel_hour} allowed`} />
        <Fact term="Codes in the last 24 hours" value={`${overview.now.day} of ${s.cap_channel_day} allowed`} />
        <Fact term="Numbers told to stop (30 days)" value={String(overview.blocks_active)} />
        <Fact
          term="Sending number"
          value={`${SENDER_SIGNAL_LABEL[s.sender_signal]}${s.sender_checked_at ? `, checked ${whenText(s.sender_checked_at)}` : ""}${setup.number ? ` · ${displayPhone(setup.number)}` : ""}`}
        />
      </dl>

      <Notice error={d.error} saved={d.saved} />
    </section>
  );
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="t-small text-soft">{term}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

"use client";

import { Choice } from "@/components/ui/Choice";
import { Input } from "@/components/ui/Input";
import { enabledChannels, normaliseWhatsapp } from "@/lib/intake/answers";
import { CHANNELS, type Channel } from "@/lib/intake/options";
import { looksMadeUp, NUMBER_WORDS } from "@/lib/messaging/number-rule";
import { StepHeading } from "./ui";
import type { StepProps } from "./types";

const ON_KEY = { whatsapp: "whatsappOk", sms: "smsOk", email: "emailOk" } as const;

/**
 * How and where to reach the person. Each channel is its own yes, recorded with the date; turning one off takes effect
 * straight away. Their reminders and their leader's messages go by the one they prefer, and move to the next only if
 * that one fails.
 */
export function ContactStep({ answers, set, email, numberRequired = false }: StepProps & { email: string | null; numberRequired?: boolean }) {
  const phone = answers.phone ?? "";
  const e164 = phone.trim() ? normaliseWhatsapp(phone) : null;
  const valid = !phone.trim() || e164 !== null;
  const hasPhone = Boolean(phone.trim() && valid);
  // While the number is compulsory: say so, show the number back as we will use it, and refuse a number that is plainly made up
  const madeUp = numberRequired && looksMadeUp(e164);
  const isOn = (c: Channel) => (c === "email" ? answers.emailOk !== false : Boolean(answers[ON_KEY[c]]) && hasPhone);
  const enabled = enabledChannels(answers);
  const first = enabled[0];

  return (
    <>
      <StepHeading title="How should we reach you?" hint="For your meeting reminder and your Friday check-in. We keep messages short, and send none between 10 pm and 6 am." />
      <div className="flex flex-col gap-8">
        <Input
          label={numberRequired ? NUMBER_WORDS.label : "Phone number"}
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          aria-required={numberRequired || undefined}
          optional={!numberRequired}
          placeholder="0803 123 4567"
          value={phone}
          onChange={(e) => {
            const next = e.target.value;
            // WhatsApp and text need a real number: without one those two go back to unticked.
            set(normaliseWhatsapp(next) ? { phone: next } : { phone: next, whatsappOk: false, smsOk: false });
          }}
          error={valid ? (madeUp ? NUMBER_WORDS.madeUp : null) : "That doesn't look like a full number. Include your network code, like 0803 123 4567."}
          hint={
            numberRequired
              ? e164 && !madeUp
                ? `${NUMBER_WORDS.showBack(e164)}. ${NUMBER_WORDS.explain}`
                : NUMBER_WORDS.explain
              : "Used for WhatsApp and text messages. Your leader sees it only if you choose WhatsApp."
          }
        />

        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-1 text-[0.95rem] font-medium">You can message me by</legend>
          {CHANNELS.map((c) => (
            <Choice
              key={c.id}
              type="checkbox"
              name={ON_KEY[c.id]}
              value="on"
              checked={isOn(c.id)}
              disabled={c.id !== "email" && !hasPhone}
              onChange={(e) => {
                set({ [ON_KEY[c.id]]: e.target.checked } as Partial<typeof answers>);
              }}
              title={c.label}
              description={c.id === "email" ? (email ? `To ${email}` : c.description) : hasPhone ? c.description : "Add your phone number first"}
            />
          ))}
        </fieldset>

        {enabled.length > 1 ? (
          <fieldset className="flex flex-col gap-2.5">
            <legend className="mb-1 text-[0.95rem] font-medium">Try this one first</legend>
            <div role="radiogroup" aria-label="Preferred way" className="segmented">
              {enabled.map((c) => (
                <label key={c}>
                  <input type="radio" name="channel" value={c} checked={first === c} onChange={() => set({ channel: c })} className="sr-only" />
                  {CHANNELS.find((x) => x.id === c)?.label}
                </label>
              ))}
            </div>
            <p className="t-small text-soft">If that one doesn’t get through, we try the next.</p>
          </fieldset>
        ) : null}

        <p className="t-small text-soft">You can change any of this later from your profile. Reply STOP on WhatsApp to turn it off.</p>
      </div>
    </>
  );
}

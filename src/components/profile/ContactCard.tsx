"use client";

import { useActionState, useState } from "react";
import { saveContactAction, type ContactState } from "@/app/(app)/profile/actions";
import { Button } from "@/components/ui/Button";
import { Choice } from "@/components/ui/Choice";
import { Input } from "@/components/ui/Input";
import { displayPhone } from "@/lib/auth/phone";
import type { Contact, Preferred } from "@/lib/messaging/contact";
import { NUMBER_WORDS } from "@/lib/messaging/number-rule";

const initial: ContactState = { status: "idle", message: "" };

const LABELS: Record<Preferred, string> = { whatsapp: "WhatsApp", email: "Email", sms: "Text message" };

/**
 * Where and how we reach the person. Each channel is its own yes: turning one on is
 * recorded with the date, turning it off takes effect straight away. Reminders, the
 * Friday check-in and anything from a leader or coach go by the channel they prefer,
 * and move to the next one only if that one fails.
 */
export function ContactCard({ contact, numberRequired = false }: { contact: Contact; numberRequired?: boolean }) {
  const [state, action, pending] = useActionState(saveContactAction, initial);
  const [on, setOn] = useState({ whatsapp: contact.whatsapp, sms: contact.sms, email: contact.email_ok });
  const [preferred, setPreferred] = useState<Preferred>(contact.preferred);

  const enabled = (["whatsapp", "email", "sms"] as const).filter((c) => on[c]);
  const effective = enabled.includes(preferred) ? preferred : (enabled[0] ?? preferred);

  return (
    <form action={action} className="card flex flex-col gap-5 p-5 sm:p-6" noValidate>
      <Input
        label={numberRequired ? NUMBER_WORDS.label : "Phone number"}
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        defaultValue={contact.phone ? displayPhone(contact.phone) : ""}
        placeholder="0803 123 4567"
        aria-required={numberRequired || undefined}
        optional={!numberRequired}
        hint={numberRequired ? NUMBER_WORDS.explain : "Used for WhatsApp and text messages. Your leader sees it only if you choose WhatsApp."}
      />

      <fieldset className="flex flex-col gap-2.5">
        <legend className="mb-1 text-[0.95rem] font-medium">You can message me by</legend>
        {(["whatsapp", "email", "sms"] as const).map((c) => (
          <Choice
            key={c}
            type="checkbox"
            name={c}
            value="on"
            checked={on[c]}
            onChange={(e) => setOn((cur) => ({ ...cur, [c]: e.target.checked }))}
            title={LABELS[c]}
            description={
              c === "whatsapp"
                ? "Reminders, your Friday check-in and messages from your tribe"
                : c === "email"
                  ? contact.email
                    ? `To ${contact.email}`
                    : "To your sign-in address"
                  : "A short text with a link, if WhatsApp isn’t an option"
            }
          />
        ))}
      </fieldset>

      {enabled.length > 1 ? (
        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-1 text-[0.95rem] font-medium">Try this one first</legend>
          <div role="radiogroup" aria-label="Preferred way" className="segmented">
            {enabled.map((c) => (
              <label key={c}>
                <input type="radio" name="preferred" value={c} checked={effective === c} onChange={() => setPreferred(c)} className="sr-only" />
                {LABELS[c]}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <input type="hidden" name="preferred" value={effective} />
      )}

      <p className="t-small text-soft">
        We keep messages short, and send nothing between 10 pm and 6 am except an urgent care alert. You can change this any time, and reply STOP on WhatsApp to turn it off.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="submit" size="md" loading={pending}>
          Save
        </Button>
        <div aria-live="polite" className="min-h-6">
          {state.status !== "idle" ? (
            <p role={state.status === "error" ? "alert" : "status"} className={`t-small ${state.status === "error" ? "text-danger" : "text-success"}`}>
              {state.message}
            </p>
          ) : null}
        </div>
      </div>
    </form>
  );
}

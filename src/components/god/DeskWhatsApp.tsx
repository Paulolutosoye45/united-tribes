"use client";

import { useState } from "react";
import { whatsappSwitchAction } from "@/app/(app)/god/leader-desk/send-actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { WA_WORDS as W, type WhatsAppState } from "@/lib/god/desk-send";

/**
 * The one switch for WhatsApp on the Desk. Off to begin with. It never sends anything itself; it only decides whether the Desk is held to email (Off) or
 * may reach each member the way they agreed to be reached (On). Every change needs a reason, the database checks it again, and turning it Off sends anything still waiting back to email.
 */
export function DeskWhatsApp({ state }: { state: WhatsAppState }) {
  const d = useDo();
  const [reason, setReason] = useState("");
  const next = !state.on;
  return (
    <form
      className="card flex flex-col gap-4 p-5"
      data-testid="desk-whatsapp"
      data-on={state.on ? "yes" : "no"}
      onSubmit={(e) => {
        e.preventDefault();
        void d.go("save", () => whatsappSwitchAction(next, reason), { saved: next ? W.savedOn : W.savedOff, after: () => setReason("") });
      }}
    >
      <div className="flex flex-col gap-1">
        <h3 className="t-heading">{W.title}</h3>
        <p className="t-small measure text-soft">{W.help}</p>
      </div>
      <div className="flex flex-col gap-1" data-testid="desk-whatsapp-status">
        <p className="t-body font-medium">{state.on ? W.on : W.off}</p>
        {state.paused ? <p className="t-small text-danger">{W.paused}</p> : null}
        <p className="t-small text-soft">{W.mode(state.mode)}</p>
        <p className="t-small text-soft">{W.reach(state.reach, state.waiting)}</p>
        <p className="t-small text-soft">{W.approval}</p>
      </div>
      <Input label={W.reason.label} hint={W.reason.hint} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      <Notice error={d.error} saved={d.saved} />
      <div>
        <Button type="submit" size="md" variant={next ? "solid" : "quiet"} loading={d.busy === "save"} disabled={reason.trim().length < 3}>
          {next ? W.turnOn : W.turnOff}
        </Button>
      </div>
    </form>
  );
}

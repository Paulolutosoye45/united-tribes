"use client";

import { useActionState, useState } from "react";
import { unlockAction, type UnlockState } from "@/app/(focus)/god/unlock/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const IDLE: UnlockState = { status: "idle", message: "" };

/** The one field that switches the owner's powers on for this sign-in. Nothing here is saved by the browser. */
export function UnlockForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(unlockAction, IDLE);
  const [show, setShow] = useState(false);

  return (
    <form action={formAction} className="flex flex-col gap-5" autoComplete="off">
      <input type="hidden" name="next" value={next} />
      <div className="relative">
        <Input
          label="Passphrase"
          name="passphrase"
          type={show ? "text" : "password"}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          autoFocus
          error={state.status === "error" ? state.message : null}
          className="pr-20"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-pressed={show}
          className="press absolute right-3 top-[2.45rem] rounded-lg px-2 py-1 text-[0.85rem] font-medium text-soft hover:text-ink"
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>
      <Button type="submit" loading={pending} fullWidth>
        Unlock
      </Button>
    </form>
  );
}

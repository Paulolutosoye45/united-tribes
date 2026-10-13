"use client";

import { useActionState } from "react";
import { changePhraseAction, type PhraseState } from "@/app/(app)/god/actions";
import { Notice } from "@/components/admin/Notice";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const IDLE: PhraseState = { status: "idle", message: "" };

/** Changing the passphrase: the old one first, then the new one twice. */
export function PassphraseForm() {
  const [state, formAction, pending] = useActionState(changePhraseAction, IDLE);
  return (
    <form action={formAction} className="flex flex-col gap-4" autoComplete="off">
      <Input label="Current passphrase" name="current" type="password" autoComplete="off" required />
      <Input label="New passphrase" name="next" type="password" autoComplete="new-password" minLength={12} required hint="At least 12 characters. Four unrelated words is a good one." />
      <Input label="New passphrase again" name="again" type="password" autoComplete="new-password" minLength={12} required />
      <Notice error={state.status === "error" ? state.message : null} saved={state.status === "ok" ? state.message : null} />
      <div>
        <Button type="submit" variant="solid" loading={pending}>
          Change passphrase
        </Button>
      </div>
    </form>
  );
}

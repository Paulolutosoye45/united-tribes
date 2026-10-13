"use client";

import { useActionState } from "react";
import { saveNameAction, type NameState } from "@/app/(app)/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const initial: NameState = { status: "idle", message: "" };

export function NameForm() {
  const [state, action, pending] = useActionState(saveNameAction, initial);
  return (
    <form action={action} className="flex max-w-md flex-col gap-3" noValidate>
      <Input
        label="What should we call you?"
        name="name"
        autoComplete="given-name"
        placeholder="Your first name"
        hint="Leaders and your tribe will see this."
        error={state.status === "error" ? state.message : null}
        maxLength={40}
        required
      />
      <Button type="submit" variant="solid" size="md" loading={pending} className="w-fit">
        Save name
      </Button>
    </form>
  );
}

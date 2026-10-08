"use client";

import { useActionState } from "react";
import { inviteAction, type ActionState } from "@/app/(app)/admin/actions";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { ROLE_LABELS, type Role } from "@/lib/auth/roles";

const initial: ActionState = { status: "idle", message: "" };

export function InviteForm({ roles }: { roles: Role[] }) {
  const [state, action, pending] = useActionState(inviteAction, initial);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
        <Input
          label="Email address"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="name@example.com"
          required
        />
        <Select label="Role" id="invite-role" name="role" defaultValue={roles.includes("leader") ? "leader" : roles[0]}>
          {roles.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </Select>
      </div>

      <p className="t-small text-soft">
        We don&apos;t email invitations yet. Tell them to sign in with this exact address and the role is added.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="submit" loading={pending}>
          Send invitation
        </Button>
        <div aria-live="polite" className="min-h-6">
          {state.status !== "idle" ? (
            <p
              role={state.status === "error" ? "alert" : "status"}
              className={`t-small ${state.status === "error" ? "text-danger" : "text-success"}`}
            >
              {state.message}
            </p>
          ) : null}
        </div>
      </div>
    </form>
  );
}

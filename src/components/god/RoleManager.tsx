"use client";

import { useState } from "react";
import { giveRoleAction, takeRoleAction } from "@/app/(app)/god/actions";
import { useDo } from "@/components/admin/useDo";
import { Notice } from "@/components/admin/Notice";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/auth/roles";

/** Roles on one person: take one away with the cross, give one with the list. The same office rules and record as anywhere. */
export function RoleManager({ person, email, roles }: { person: string; email: string; roles: Role[] }) {
  const { busy, error, saved, go } = useDo();
  const available = ROLES.filter((r) => r !== "member" && !roles.includes(r));
  const [pick, setPick] = useState<Role | "">("");
  const held = roles.filter((r) => r !== "member");

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-wrap items-center gap-2" aria-label="Roles">
        <li>
          <Badge tone="neutral">Member</Badge>
        </li>
        {held.map((role) => (
          <li key={role} className="flex items-center gap-0.5">
            <Badge tone={role === "admin" ? "charcoal" : "gold"}>{ROLE_LABELS[role]}</Badge>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => go(`take-${role}`, () => takeRoleAction(person, role), { saved: `${ROLE_LABELS[role]} removed.` })}
              aria-label={`Remove ${ROLE_LABELS[role]}`}
              className="press grid h-9 w-9 place-items-center rounded-full text-soft hover:bg-surface-strong hover:text-ink disabled:opacity-50"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <path d="m3 3 8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
      {available.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`give-${person}`}>
            Give a role
          </label>
          <select
            id={`give-${person}`}
            value={pick}
            onChange={(e) => setPick(e.target.value as Role | "")}
            className="h-11 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base"
          >
            <option value="">Give a role…</option>
            {available.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            variant="solid"
            loading={busy === "give"}
            disabled={!pick || busy !== null}
            onClick={() => {
              if (!pick) return;
              void go("give", () => giveRoleAction(person, email, pick), { saved: `${ROLE_LABELS[pick]} given.`, after: () => setPick("") });
            }}
          >
            Give
          </Button>
        </div>
      ) : null}
      <Notice error={error} saved={saved} />
    </div>
  );
}

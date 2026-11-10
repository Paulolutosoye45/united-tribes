"use client";

import { useState } from "react";
import { addMemberAction } from "@/app/(app)/god/leader-desk/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { DESK_WORDS as W, type DraftFit } from "@/lib/god/desk";

/** Puts a waiting member into one of the draft groups. The group's own rules decide: a group they cannot join is not offered. */
export function DeskAddToDraft({ person, drafts }: { person: string; drafts: DraftFit[] }) {
  const d = useDo();
  const open = drafts.filter((x) => x.fits);
  const [pick, setPick] = useState("");
  if (open.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`draft-${person}`}>
          Add to a draft group
        </label>
        <select
          id={`draft-${person}`}
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          className="h-10 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-[0.95rem]"
        >
          <option value="">Add to a draft…</option>
          {open.map((x) => (
            <option key={x.groupId} value={x.groupId}>
              {W.fitsDraft(x.name, x.degree)}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          variant="solid"
          disabled={pick === ""}
          loading={d.busy === "add"}
          onClick={() => void d.go("add", () => addMemberAction(pick, person), { after: () => setPick("") })}
        >
          Add
        </Button>
      </div>
      <Notice error={d.error} saved={d.saved} />
    </div>
  );
}

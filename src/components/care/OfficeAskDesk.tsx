"use client";

import { useState } from "react";
import { closeOfficeAskAction } from "@/app/(app)/care/teens/office-actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { lagosWhen } from "@/lib/features/wording";
import type { OfficeAsk } from "@/lib/profile/types";

/**
 * People who said their age range is not right in a way the list cannot fix. The Care Team reads what they wrote, speaks to them (and to a parent or
 * guardian where the young people's rules say so) and then marks it looked at, with a short note the person reads on their own page. Nothing here changes
 * anyone's age range.
 */
export function OfficeAskDesk({ asks }: { asks: OfficeAsk[] }) {
  return (
    <section aria-labelledby="office-asks-h" className="flex flex-col gap-3" data-testid="office-asks">
      <div className="flex flex-col gap-1">
        <h2 id="office-asks-h" className="t-heading">
          Age range not right
        </h2>
        <p className="t-small text-soft">
          These people say the age range we hold for them is wrong in a way the list cannot fix. Nothing has been changed for them. Speak to them first, and to a
          parent or guardian where the young people’s rules say so.
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {asks.map((a) => (
          <Ask key={a.id} a={a} />
        ))}
      </ul>
    </section>
  );
}

function Ask({ a }: { a: OfficeAsk }) {
  const d = useDo();
  const [note, setNote] = useState("");
  const open = a.status === "open";
  return (
    <li className="card flex flex-col gap-3 p-5" data-testid={`office-ask-${a.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{a.person}</h3>
        <Badge tone={open ? "gold" : "outline"}>{open ? "Waiting" : "Looked at"}</Badge>
      </div>
      <p className="t-small text-soft">
        We hold <strong>{a.held || "no age range"}</strong>. Asked {lagosWhen(a.askedAt)}.
      </p>
      {a.note ? <p className="t-body">“{a.note}”</p> : <p className="t-small text-soft">They left no note.</p>}
      {open ? (
        <div className="flex flex-col gap-3">
          <Input label="A short note they will read on their page (optional)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} data-testid={`office-ask-note-${a.id}`} />
          <div>
            <Button size="md" loading={d.busy === "close"} disabled={d.busy !== null} onClick={() => void d.go("close", () => closeOfficeAskAction(a.id, note), { saved: "Marked as looked at." })} data-testid={`office-ask-close-${a.id}`}>
              I have looked at this
            </Button>
          </div>
        </div>
      ) : (
        <p className="t-small text-soft">
          Looked at {a.closedAt ? lagosWhen(a.closedAt) : ""}
          {a.closingNote ? `. You wrote: “${a.closingNote}”` : "."}
        </p>
      )}
      <Notice error={d.error} saved={d.saved} />
    </li>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { careTaskOptionsAction, completeCareTaskAction, reassignCareTaskAction } from "@/app/(app)/rhythm/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { formatShortDate } from "@/lib/dates";
import type { CareTask, CareTaskOption } from "@/lib/rhythm/types";
import { TASK_LABELS, dueLine } from "@/lib/rhythm/wording";

const ROLE_NAMES: Record<string, string> = { assistant: "Assistant leader", coach: "Coach", leader: "Leader", care_lead: "Care Lead" };

type Mode = "done" | "dismissed" | "pass";

/** Care tasks as cards. The person they are assigned to can finish them; the care team can also pass them on. */
export function CareTaskList({
  tasks,
  emptyText,
  canAct,
  canPass,
  readOnly,
}: {
  tasks: CareTask[];
  emptyText: string;
  canAct: boolean;
  canPass: boolean;
  /** For the list of what a leader raised: the status only. */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<{ id: string; mode: Mode } | null>(null);
  const [note, setNote] = useState("");
  const [options, setOptions] = useState<CareTaskOption[]>([]);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function begin(id: string, mode: Mode) {
    if (open?.id === id && open.mode === mode) return setOpen(null);
    setError(null);
    setNote("");
    setTo("");
    setOpen({ id, mode });
    if (mode === "pass") {
      const result = await careTaskOptionsAction(id);
      if (result.ok) setOptions(result.options);
      else setError(result.message);
    }
  }

  async function submit(t: CareTask) {
    if (!open) return;
    setBusy(t.id);
    setError(null);
    const result =
      open.mode === "pass" ? await reassignCareTaskAction(t.id, to) : await completeCareTaskAction(t.id, open.mode, note);
    setBusy(null);
    if (!result.ok) return setError(result.message);
    setOpen(null);
    router.refresh();
  }

  if (tasks.length === 0) return <p className="t-body text-soft">{emptyText}</p>;

  return (
    <div className="flex flex-col gap-3">
      <ul className="stagger flex flex-col gap-3">
        {tasks.map((t, i) => {
          const label = TASK_LABELS[t.kind];
          const isOpen = open?.id === t.id;
          return (
            <li key={t.id} style={{ ["--i" as string]: Math.min(i, 8) }} className="card flex flex-col gap-3 p-5" data-task-kind={t.kind}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold leading-snug">
                    {t.member ?? "The leader"} <span className="font-normal text-soft">· {t.tribe.name}</span>
                  </p>
                  <p className="t-small text-soft">{label.title}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {t.status === "open" ? (
                    <Badge tone={t.kind === "urgent" || t.overdue ? "flame" : t.days_left <= 2 ? "gold" : "neutral"}>{dueLine(t.days_left)}</Badge>
                  ) : (
                    <Badge tone={t.status === "done" ? "gold" : "outline"}>{t.status === "done" ? "Done" : "Not needed"}</Badge>
                  )}
                  {t.assignee_role ? <Badge tone="outline">{t.assigned_to ?? ROLE_NAMES[t.assignee_role] ?? t.assignee_role}</Badge> : null}
                </div>
              </div>

              {t.note ? <p className="t-body whitespace-pre-line rounded-[var(--radius-control)] bg-surface-strong p-3">{t.note}</p> : null}
              {t.status === "open" && !readOnly ? <p className="t-small text-soft">{label.advice}</p> : null}
              <p className="t-small text-soft">
                {t.raised_by ? `Raised by ${t.raised_by}` : "Raised automatically"} · {formatShortDate(t.created_at)}
                {t.leader && t.kind !== "coach_help" ? ` · Leader: ${t.leader}` : ""}
                {t.closed_note ? ` · ${t.closed_note}` : ""}
              </p>

              {t.status === "open" && !readOnly && (canAct || canPass) ? (
                <div className="flex flex-wrap items-center gap-2.5">
                  {canAct ? (
                    <Button size="sm" variant="solid" aria-expanded={isOpen && open?.mode === "done"} onClick={() => void begin(t.id, "done")}>
                      Mark done
                    </Button>
                  ) : null}
                  {canAct ? (
                    <Button size="sm" variant="ghost" aria-expanded={isOpen && open?.mode === "dismissed"} onClick={() => void begin(t.id, "dismissed")}>
                      Not needed
                    </Button>
                  ) : null}
                  {canPass ? (
                    <Button size="sm" variant="quiet" aria-expanded={isOpen && open?.mode === "pass"} onClick={() => void begin(t.id, "pass")}>
                      Pass on
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {isOpen && open ? (
                <form
                  noValidate
                  className="flex flex-col gap-3 border-t border-line pt-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit(t);
                  }}
                >
                  {open.mode === "pass" ? (
                    <Select label="Pass it to" value={to} onChange={(e) => setTo(e.target.value)}>
                      <option value="">Choose a person</option>
                      {options.map((o) => (
                        <option key={`${o.role}-${o.id}`} value={o.id}>
                          {o.name} ({ROLE_NAMES[o.role]})
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      label={open.mode === "done" ? "What did you do? (optional)" : "Why is it not needed?"}
                      name={`note-${t.id}`}
                      optional={open.mode === "done"}
                      maxLength={300}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  )}
                  <div>
                    <Button type="submit" size="sm" loading={busy === t.id} disabled={open.mode === "pass" && !to}>
                      {open.mode === "pass" ? "Pass it on" : open.mode === "done" ? "Save as done" : "Close this task"}
                    </Button>
                  </div>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>
      {error ? (
        <p role="alert" className="t-small text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

"use client";

import { useState } from "react";
import { declineErasureAction, erasePersonAction, recordErasureAction } from "@/app/(app)/admin/privacy/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { formatShortDate, plural } from "@/lib/dates";
import { ROLE_LABELS, isRole } from "@/lib/auth/roles";
import type { ErasureRequest } from "@/lib/admin/types";
import { blockerText, whatItTouches } from "@/lib/privacy/wording";
import { Notice } from "./Notice";
import { useDo } from "./useDo";

export function ErasureBoard({ queue, me }: { queue: ErasureRequest[]; me: string }) {
  const open = queue.filter((r) => r.status === "open");
  const declined = queue.filter((r) => r.status === "declined");
  // What was done, kept up here: the request it was about leaves the list as soon as it is answered.
  const [done, setDone] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-10">
      <Notice error={null} saved={done} />
      <section aria-labelledby="open-heading" className="flex flex-col gap-4">
        <h2 id="open-heading" className="t-heading">
          Waiting for an answer
        </h2>
        {open.length === 0 ? (
          <p className="card t-body p-6 text-soft">No one is waiting. Requests appear here when a member asks from their profile, or when you write one down below.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {open.map((r) => (
              <li key={r.person}>
                <Request request={r} mine={r.person === me} onDone={setDone} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="record-heading" className="flex flex-col gap-4">
        <h2 id="record-heading" className="t-heading">
          Someone asked another way
        </h2>
        <RecordForm />
      </section>

      {declined.length > 0 ? (
        <section aria-labelledby="declined-heading" className="flex flex-col gap-4">
          <h2 id="declined-heading" className="t-heading">
            Answered: not now
          </h2>
          <ul className="flex flex-col gap-3">
            {declined.map((r) => (
              <li key={r.person} className="card flex flex-col gap-1 p-4 sm:p-5">
                <p className="font-semibold">{r.name}</p>
                <p className="t-small text-soft">
                  {r.email} · answered {r.decided_at ? formatShortDate(r.decided_at) : ""}
                </p>
                <p className="t-small">{r.decision_note}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Request({ request: r, mine, onDone }: { request: ErasureRequest; mine: boolean; onDone: (message: string) => void }) {
  const d = useDo();
  const [mode, setMode] = useState<"idle" | "erase" | "decline">("idle");
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const blocked = r.blockers.length > 0;
  const roles = r.roles.map((x) => (isRole(x) ? ROLE_LABELS[x] : x));

  return (
    <article className="card flex flex-col gap-4 p-5 sm:p-6" aria-label={`Request from ${r.name}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="t-heading">{r.name}</h3>
          <p className="t-small truncate text-soft">{r.email}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {roles.map((x) => (
            <Badge key={x} tone="gold">
              {x}
            </Badge>
          ))}
          {r.by_office ? <Badge tone="outline">Written down by the office</Badge> : null}
        </div>
      </div>
      <p className="t-small text-soft">Asked on {formatShortDate(r.requested_at)}</p>
      {r.note ? (
        <p className="t-small rounded-[var(--radius-control)] bg-surface px-4 py-3">
          <span className="font-semibold">Their note: </span>
          {r.note}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <p className="t-small font-semibold">Deleting would remove</p>
        <ul className="t-small flex list-disc flex-col gap-1 pl-5 text-soft">
          {whatItTouches(r).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {r.in_tribes > 0 || r.care_records > 0 ? (
          <p className="t-small text-soft">
            {r.in_tribes > 0 ? plural(r.in_tribes, "current tribe") : ""}
            {r.in_tribes > 0 && r.care_records > 0 ? " · " : ""}
            {r.care_records > 0 ? plural(r.care_records, "care record") : ""}
          </p>
        ) : null}
      </div>

      {blocked ? (
        <ul role="note" className="t-small flex flex-col gap-1.5 rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-danger">
          {r.blockers.map((b) => (
            <li key={b}>{blockerText(b)}</li>
          ))}
        </ul>
      ) : null}

      <Notice error={d.error} />

      {mode === "idle" ? (
        <div className="flex flex-wrap gap-3">
          <Button variant="solid" size="md" disabled={blocked || mine || d.busy !== null} onClick={() => setMode("erase")}>
            Delete their account…
          </Button>
          <Button variant="quiet" size="md" disabled={d.busy !== null} onClick={() => setMode("decline")}>
            Say not now…
          </Button>
        </div>
      ) : null}

      {mode === "erase" ? (
        <form
          noValidate
          className="pop-in flex flex-col gap-3 rounded-[var(--radius-control)] border border-danger/40 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim().toLowerCase() !== r.email.toLowerCase()) return;
            void d.go("erase", () => erasePersonAction(r.person), { after: () => onDone(`${r.name}’s account has been deleted.`) });
          }}
        >
          <p className="font-semibold">Delete {r.name}’s account for good?</p>
          <p className="t-small text-soft">This cannot be undone. Backups roll off on their own schedule (docs/RETENTION.md). To go ahead, type their email address.</p>
          <Input label="Their email address" name="confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" placeholder={r.email} />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="solid" size="md" loading={d.busy === "erase"} disabled={d.busy !== null || typed.trim().toLowerCase() !== r.email.toLowerCase()}>
              Delete the account
            </Button>
            <Button type="button" variant="ghost" size="md" disabled={d.busy !== null} onClick={() => setMode("idle")}>
              Not yet
            </Button>
          </div>
        </form>
      ) : null}

      {mode === "decline" ? (
        <form
          noValidate
          className="pop-in flex flex-col gap-3 rounded-[var(--radius-control)] border border-line p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void d.go("decline", () => declineErasureAction(r.person, reason), { after: () => onDone(`Your answer to ${r.name} has been saved. They will read it on their profile.`) });
          }}
        >
          <Textarea label="Why not yet? They will read this" name="reason" rows={3} maxLength={600} value={reason} onChange={(e) => setReason(e.target.value)} hint="Say what has to happen first, or what the church must keep and why." />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="solid" size="md" loading={d.busy === "decline"} disabled={d.busy !== null || reason.trim().length < 3}>
              Send my answer
            </Button>
            <Button type="button" variant="ghost" size="md" disabled={d.busy !== null} onClick={() => setMode("idle")}>
              Back
            </Button>
          </div>
        </form>
      ) : null}
    </article>
  );
}

function RecordForm() {
  const d = useDo();
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  return (
    <form
      noValidate
      className="card flex flex-col gap-4 p-5 sm:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        void d.go("record", () => recordErasureAction(email, note), {
          saved: "Written down. It now waits above for an answer.",
          after: () => {
            setEmail("");
            setNote("");
          },
        });
      }}
    >
      <p className="t-small max-w-[60ch] text-soft">
        If a member asked you by email or in person, write it down here so it goes through the same checks. Use the address they sign in with. They must have signed in at least once.
      </p>
      <Input label="Their sign-in email address" name="email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Textarea label="What they said" name="note" rows={2} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} optional />
      <Notice error={d.error} saved={d.saved} />
      <Button type="submit" variant="quiet" size="md" className="w-fit" loading={d.busy === "record"} disabled={d.busy !== null || email.trim().length < 5}>
        Write it down
      </Button>
    </form>
  );
}

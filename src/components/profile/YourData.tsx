"use client";

import { useState } from "react";
import { requestErasureAction, withdrawErasureAction } from "@/app/(app)/profile/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { formatShortDate } from "@/lib/dates";
import type { ErasureState } from "@/lib/privacy/wording";

/**
 * A copy of what we hold, and the way to ask for the account to be deleted. Deleting is a request the church office
 * answers (they may have to check first), not a button that does it at once, and the page says so.
 */
export function YourData({ request }: { request: ErasureState }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-col gap-4 p-5 sm:p-6">
        <div className="max-w-[56ch]">
          <p className="font-semibold">Download a copy of my data</p>
          <p className="t-small text-soft">
            One file with everything we hold about you: your answers, your tribe and meeting history, your messages and the private notes you wrote, opened for you here and nowhere else.
          </p>
        </div>
        {/* A plain link: the browser saves the file. */}
        <a href="/profile/data" download className={buttonClasses({ variant: "quiet", size: "md", className: "w-fit" })}>
          <span className="relative">Download my data</span>
        </a>
      </div>
      <DeleteAccount request={request} />
    </div>
  );
}

function DeleteAccount({ request }: { request: ErasureState }) {
  const d = useDo();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");

  if (request.status === "open") {
    return (
      <div className="card flex flex-col gap-4 p-5 sm:p-6">
        <div className="max-w-[56ch]">
          <p className="font-semibold">You have asked for your account to be deleted</p>
          <p className="t-small text-soft">
            You asked on <strong>{formatShortDate(request.requested_at)}</strong>. The church office will look at it and you will see their answer here. Until then your account works as normal.
          </p>
        </div>
        <Notice error={d.error} />
        <Button variant="quiet" size="md" className="w-fit" loading={d.busy === "withdraw"} disabled={d.busy !== null} onClick={() => void d.go("withdraw", () => withdrawErasureAction())}>
          I’ve changed my mind
        </Button>
      </div>
    );
  }

  if (request.status === "declined") {
    return (
      <div className="card flex flex-col gap-4 p-5 sm:p-6">
        <div className="max-w-[56ch]">
          <p className="font-semibold">The church office could not delete your account yet</p>
          <p className="t-small mt-1 rounded-[var(--radius-control)] bg-surface px-4 py-3">{request.decision_note}</p>
          {request.decided_at ? <p className="t-small mt-2 text-soft">Answered on {formatShortDate(request.decided_at)}.</p> : null}
        </div>
        <Notice error={d.error} />
        <div className="flex flex-wrap gap-3">
          <Button variant="quiet" size="md" loading={d.busy === "again"} disabled={d.busy !== null} onClick={() => void d.go("again", () => requestErasureAction(""))}>
            Ask again
          </Button>
          <Button variant="ghost" size="md" loading={d.busy === "clear"} disabled={d.busy !== null} onClick={() => void d.go("clear", () => withdrawErasureAction())}>
            Dismiss this
          </Button>
        </div>
      </div>
    );
  }

  if (!asking) {
    return (
      <div className="card flex flex-col gap-4 p-5 sm:p-6">
        <div className="max-w-[56ch]">
          <p className="font-semibold">Delete my account</p>
          <p className="t-small text-soft">Ask the church office to delete your account and everything in it. You decide; they carry it out.</p>
        </div>
        <Button variant="quiet" size="md" className="w-fit" onClick={() => setAsking(true)}>
          Ask for my account to be deleted
        </Button>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="pop-in card flex flex-col gap-4 border-danger/40 p-5 sm:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        void d.go("ask", () => requestErasureAction(note), { after: () => setAsking(false) });
      }}
    >
      <p className="font-semibold">Ask for your account to be deleted?</p>
      <ul className="t-small flex max-w-[56ch] list-disc flex-col gap-1.5 pl-5 text-soft">
        <li>This removes your answers, your place in any tribe, your attendance and check-ins, your messages, your testimonies and your photo.</li>
        <li>It can’t be undone, and you will be signed out when it is done. You can always sign up again later as a new member.</li>
        <li>The church office looks at each request first. If you lead a tribe, they will arrange someone to take over before they delete you. If the church must keep a record, they will tell you here, with the reason.</li>
        <li>If you only want to stop being matched or messaged, use “Delete my answers” or the choices above instead.</li>
      </ul>
      <Textarea label="Anything you would like the office to know" name="note" rows={3} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} optional />
      <Notice error={d.error} />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="solid" size="md" loading={d.busy === "ask"} disabled={d.busy !== null}>
          Send my request
        </Button>
        <Button type="button" variant="ghost" size="md" disabled={d.busy !== null} onClick={() => setAsking(false)}>
          Keep my account
        </Button>
      </div>
    </form>
  );
}

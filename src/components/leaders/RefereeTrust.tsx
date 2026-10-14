"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { clearFlagsAction, confirmStandingAction } from "@/app/(app)/review/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import { formatShortDate } from "@/lib/dates";
import { FLAG_LABEL, STAGE_STEPS, VERIFICATION_LABEL, standingLabel, stageRank } from "@/lib/leaders/referee/labels";
import type { ReviewReferee } from "@/lib/leaders/referee/types";

const TONE = { good: "gold", info: "neutral", warn: "flame", bad: "charcoal" } as const;

const CALLBACK_LINE: Record<string, string> = {
  open: "A call-back to this referee is waiting for the care team.",
  done: "The care team called back and the referee said it was theirs.",
  dismissed: "The care team could not reach this referee after three tries.",
};

/**
 * What has been proved about one referee, for the panel only. It says who they are in words (on the church’s list, confirmed by a
 * pastor, only a verified contact), what held the reference back, and what the pastors can do about it. The applicant sees none of this.
 */
export function RefereeTrust({ appId, trust, answered }: { appId: string; trust: ReviewReferee; answered: boolean }) {
  const v = VERIFICATION_LABEL[trust.verification];
  const open = trust.flags.filter((f) => !f.cleared);
  const cleared = trust.flags.filter((f) => f.cleared);
  const claimedButNot = trust.claimedHead && !trust.standing && trust.verification !== "disputed";

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-surface px-4 py-3" data-testid={`trust-${trust.slot}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TONE[v.tone]}>{v.short}</Badge>
        {trust.standing ? <Badge tone="gold">Counts as pastor or unit head</Badge> : null}
        {trust.held ? <Badge tone="flame">Held for a look</Badge> : null}
        {trust.legacy ? <Badge tone="outline">Before referees were checked</Badge> : null}
      </div>
      <p className="t-small text-soft">{v.long}</p>

      {trust.directory ? (
        <p className="t-small">
          <span className="text-soft">On the church’s list as</span> <strong className="font-semibold">{trust.directory.name}</strong>, {standingLabel(trust.directory.standing).toLowerCase()}
          {trust.directory.unit ? `, ${trust.directory.unit}` : ""}.
        </p>
      ) : null}
      {trust.verification === "pastor" && trust.confirmedBy ? (
        <p className="t-small">
          <span className="text-soft">Confirmed by</span> <strong className="font-semibold">{trust.confirmedBy}</strong>
          {trust.confirmedNote ? <span className="text-soft"> · “{trust.confirmedNote}”</span> : null}
        </p>
      ) : null}
      {trust.verifiedAt ? (
        <p className="t-small text-soft">
          Proved they hold the {trust.verifiedKind === "email" ? "email address" : "phone number"} on {formatShortDate(trust.verifiedAt)}.
        </p>
      ) : !answered ? (
        <RequestProgress stage={trust.stage} />
      ) : null}
      {trust.legacy && trust.reverifySent && !trust.reverified ? <p className="t-small text-soft">We have asked them to confirm this reference was theirs. They haven’t replied yet.</p> : null}
      {trust.legacy && trust.reverified && trust.verification !== "disputed" ? <p className="t-small text-soft">They have since confirmed this reference was theirs.</p> : null}
      {trust.changes > 0 ? <p className="t-small text-soft">The applicant changed this referee {trust.changes} {trust.changes === 1 ? "time" : "times"} after the request went out.</p> : null}

      {claimedButNot ? (
        <p className="t-small rounded-[var(--radius-control)] bg-flame/10 px-3 py-2">
          The applicant says this person is a pastor or unit head, but they aren’t on the church’s list{trust.verification === "contact" ? ", so only their contact is verified" : ""}. {trust.canConfirm ? "If you know they are, confirm it below." : "A pastor can confirm it."}
        </p>
      ) : null}

      {open.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="Why this reference is held">
          {open.map((f) => (
            <li key={f.kind} className={cn("rounded-[var(--radius-control)] px-3 py-2", f.severity === "hold" ? "bg-danger/10" : "bg-raised")} data-testid={`flag-${f.kind}`}>
              <p className={cn("t-small font-semibold", f.severity === "hold" && "text-danger")}>
                {FLAG_LABEL[f.kind]?.title ?? f.kind} <span className="font-normal text-soft">· {f.severity === "hold" ? "holds the reference" : "a note"}</span>
              </p>
              <p className="t-small text-soft">{FLAG_LABEL[f.kind]?.help ?? f.detail}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {cleared.length > 0 ? (
        <p className="t-small text-soft">
          Looked at and cleared by {cleared[0].clearedBy ?? "a pastor"}: {cleared.map((f) => FLAG_LABEL[f.kind]?.title ?? f.kind).join("; ")}.{cleared[0].clearedNote ? ` “${cleared[0].clearedNote}”` : ""}
        </p>
      ) : null}
      {trust.callback ? <p className="t-small text-soft">{CALLBACK_LINE[trust.callback.status] ?? "A call-back was set up for this referee."}{trust.callback.outcome === "not_them" ? " They said it was not theirs." : ""}{trust.callback.note ? ` “${trust.callback.note}”` : ""}</p> : null}

      {trust.canConfirm || trust.canClear ? <Actions appId={appId} trust={trust} /> : null}
    </div>
  );
}

function RequestProgress({ stage }: { stage: string }) {
  const done = stageRank(stage);
  return (
    <p className="t-small text-soft">
      {done === 0 ? "No request has gone to them yet." : `Request: ${STAGE_STEPS.slice(0, done).map((s) => s.label.toLowerCase()).join(", ")}.`}
    </p>
  );
}

function Actions({ appId, trust }: { appId: string; trust: ReviewReferee }) {
  const router = useRouter();
  const [form, setForm] = useState<null | "confirm" | "clear">(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const result = form === "confirm" ? await confirmStandingAction(appId, trust.id, note) : await clearFlagsAction(appId, trust.id, note);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setForm(null);
    setNote("");
    router.refresh();
  }

  if (!form) {
    return (
      <div className="flex flex-wrap gap-2">
        {trust.canConfirm ? (
          <Button size="sm" variant="quiet" onClick={() => setForm("confirm")} data-testid={`confirm-${trust.slot}`}>
            Confirm they are a pastor or unit head
          </Button>
        ) : null}
        {trust.canClear ? (
          <Button size="sm" variant="quiet" onClick={() => setForm("clear")} data-testid={`clear-${trust.slot}`}>
            I’ve looked at this. It’s fine
          </Button>
        ) : null}
      </div>
    );
  }
  const confirm = form === "confirm";
  return (
    <div className="pop-in flex flex-col gap-3">
      <Textarea
        label={confirm ? "How do you know they are a pastor or unit head?" : "What did you check?"}
        name="trust-note"
        rows={3}
        maxLength={300}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        hint={confirm ? "A line is enough, such as “Pastor of Ota Central, I know him.” It stays on the record." : "At least a sentence. For example, who you spoke to. It stays on the record."}
      />
      {error ? (
        <p role="alert" className="t-small text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex gap-3">
        <Button size="sm" loading={busy} disabled={note.trim().length < (confirm ? 3 : 10)} onClick={() => void save()}>
          {confirm ? "Confirm" : "Mark as looked at"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setForm(null)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

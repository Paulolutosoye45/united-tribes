"use client";

import Link from "next/link";
import { useState } from "react";
import { placeOneAction, placeOneCheckAction } from "@/app/(app)/god/placement/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { Select, Textarea } from "@/components/ui/Input";
import { formatShortDate } from "@/lib/dates";
import type { OneCheck, OneOption } from "@/lib/placement/types";

/**
 * Place one person in one tribe (God Mode). The owner chooses a tribe; the database says what would stop it and what needs a reason, and
 * nothing happens until every warning is accepted and explained. The person is then told exactly as a church run tells them, and the
 * placement can be undone until the tribe's leader has been told.
 */
export function PlaceOne({ person, name, options, mode }: { person: string; name: string; options: OneOption[]; mode: "off" | "rehearsal" | "on" | null }) {
  const d = useDo();
  const [tribe, setTribe] = useState("");
  const [check, setCheck] = useState<OneCheck | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [reason, setReason] = useState("");
  const [placedRun, setPlacedRun] = useState<string | null>(null);

  async function choose(next: string) {
    setTribe(next);
    setCheck(null);
    setAccepted(false);
    setAgreed(false);
    setPlacedRun(null);
    if (!next) return;
    await d.go("check", async () => {
      const r = await placeOneCheckAction(person, next);
      if (r.ok) setCheck(r.check);
      return r.ok ? { ok: true as const } : r;
    });
  }

  const warnings = check?.warnings ?? [];
  const needsAgreement = warnings.some((w) => w.code === "no_consent");
  const blocked = !check || check.blockers.length > 0;
  const reasonOk = warnings.length === 0 || reason.trim().length >= 5;
  const ready = !blocked && (warnings.length === 0 || accepted) && reasonOk && (!needsAgreement || agreed) && mode === "on";

  async function place() {
    if (!check) return;
    await d.go(
      "place",
      async () => {
        const r = await placeOneAction({ person, tribe, accept: warnings.map((w) => w.code), reason, agreed });
        if (r.ok) setPlacedRun(r.run);
        return r.ok ? { ok: true as const } : r;
      },
      { saved: `${name} is placed. They have been emailed.` },
    );
  }

  if (options.length === 0) {
    return <p className="t-body text-soft">There are no open tribes with a certified leader to place {name} in.</p>;
  }

  return (
    <div className="flex flex-col gap-4" data-testid="place-one">
      <p className="t-small measure text-soft">
        This places {name} the same way a church run does: they get the “Your tribe” email with a private link to say yes, hold back their details or look at other tribes, and the leader is told in the same way. You can undo it until the leader has been told.
      </p>
      {mode !== "on" ? (
        <p className="t-small rounded-[var(--radius-control)] bg-gold/20 p-3" data-testid="place-one-off">
          Placement is {mode === "rehearsal" ? "in Rehearsal" : "Off"}. Switch it On on the Placement page to place someone.
        </p>
      ) : null}
      <Select label="Place them in" value={tribe} onChange={(e) => void choose(e.target.value)} disabled={d.busy !== null || placedRun !== null} data-testid="place-one-tribe">
        <option value="">Choose a tribe</option>
        {options.map((o) => (
          <option key={o.tribe} value={o.tribe}>
            {o.name} · {o.leader} · {o.active} of {o.capacity} seats{o.degree === null ? " · no fit score" : ` · ${o.degree}% ${o.label ?? ""}`}
          </option>
        ))}
      </Select>

      {check ? (
        <div className="flex flex-col gap-3" data-testid="place-one-check">
          <p className="t-body">
            {check.degree === null ? "There is no fit score for this tribe." : `Fit with ${check.tribe.name}: ${check.degree}% (${check.label}).`} {check.tribe.active} of {check.tribe.capacity} seats are taken.
            {check.window?.started
              ? ` ${check.window.name} is in week ${check.window.week ?? 1}; joining ${check.window.open ? "is open" : "closed"} until ${formatShortDate(check.window.closesOn)}.`
              : ""}
          </p>
          {check.blockers.length > 0 ? (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-danger" role="alert" data-testid="place-one-blockers">
              {check.blockers.map((b) => (
                <li key={b.code}>{b.text}. This cannot be done from here.</li>
              ))}
            </ul>
          ) : null}
          {warnings.length > 0 && check.blockers.length === 0 ? (
            <div className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-gold/20 p-4" data-testid="place-one-warnings">
              <p className="font-semibold">Before you place them</p>
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {warnings.map((w) => (
                  <li key={w.code}>{w.text}</li>
                ))}
              </ul>
              <label className="flex items-start gap-3">
                <input type="checkbox" className="mt-1 h-5 w-5" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
                <span>I have read each of these and I want to place them anyway.</span>
              </label>
              {needsAgreement ? (
                <label className="flex items-start gap-3" data-testid="place-one-agreed">
                  <input type="checkbox" className="mt-1 h-5 w-5" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                  <span>{name} has told me they agree to be matched and placed. This is recorded as your word; it does not record any agreement from them.</span>
                </label>
              ) : null}
              <Textarea label="Why? (a few words, kept with the placement)" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} rows={2} data-testid="place-one-reason" />
            </div>
          ) : null}
          {placedRun === null ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button size="md" variant="solid" loading={d.busy === "place"} disabled={!ready} onClick={() => void place()} data-testid="place-one-go">
                Place {name}
              </Button>
              {mode === "on" && !blocked && !ready ? <span className="t-small text-soft">Tick the boxes and give a reason to go on.</span> : null}
            </div>
          ) : (
            <p className="t-body" data-testid="place-one-done">
              Done. <Link href={`/god/placement/${placedRun}`} className="font-semibold underline underline-offset-4">Open the placement</Link> to see it, or to undo it before the leader is told.
            </p>
          )}
        </div>
      ) : null}
      <Notice error={d.error} saved={d.saved} />
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { officeAskAction, officeCheckAction, officePlaceAction, undoOneAction } from "@/app/(app)/admin/tribes/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { Select, Textarea } from "@/components/ui/Input";
import { formatShortDate } from "@/lib/dates";
import type { OneCheck, OneOption, PlacementMode, PlacerRole } from "@/lib/placement/types";

/**
 * Place one person in one tribe, or move a member who has a seat to another. Used in God Mode and in Admin (the person's page and the tribe's page):
 * the same checks, the same placement. The database says what would stop it and what needs a reason, and nothing happens until every warning is
 * accepted and explained. An admin or a director can accept only some warnings; when another one is in the way the button becomes "Ask the owner".
 * The person is told exactly as a church run tells them, and the placement can be undone until the tribe's leader has been told.
 */
export function PlaceOne({
  person, name, options, mode, role, move = false, fixedTribe, ownerLink = false,
}: {
  person: string;
  name: string;
  options: OneOption[];
  mode: PlacementMode | null;
  role: PlacerRole;
  move?: boolean;
  /** The tribe is already chosen (the tribe's own page). */
  fixedTribe?: { id: string; name: string };
  /** The owner may open the run's own page. */
  ownerLink?: boolean;
}) {
  const d = useDo();
  // Fixed at the first look: the seat they hold after being placed must not turn the receipt into a move
  const [isMove] = useState(move);
  const [tribe, setTribe] = useState(fixedTribe?.id ?? "");
  const [check, setCheck] = useState<OneCheck | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [reason, setReason] = useState("");
  const [receipt, setReceipt] = useState<{ kind: "placed"; run: string; tribe: string } | { kind: "asked" } | { kind: "undone"; restored: boolean } | null>(null);

  const choices = options.filter((o) => !(isMove && o.current));

  async function choose(next: string) {
    setTribe(next);
    setCheck(null);
    setAccepted(false);
    setAgreed(false);
    setReceipt(null);
    if (!next) return;
    await d.go("check", async () => {
      const r = await officeCheckAction(person, next, isMove);
      if (r.ok) setCheck(r.check);
      return r.ok ? { ok: true as const } : r;
    });
  }

  // A fixed tribe is checked as soon as the panel opens
  const fixedId = fixedTribe?.id;
  useEffect(() => {
    if (fixedId) void choose(fixedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixedId, person]);

  const warnings = check?.warnings ?? [];
  const asking = role !== "owner" && warnings.some((w) => w.ownerOnly);
  const needsAgreement = warnings.some((w) => w.code === "no_consent");
  const blocked = !check || check.blockers.length > 0;
  const reasonOk = warnings.length === 0 || reason.trim().length >= 5;
  const ready = !blocked && (warnings.length === 0 || accepted) && reasonOk && (!needsAgreement || agreed) && mode === "on" && receipt === null;
  const verb = isMove ? "Move" : "Place";

  async function go() {
    if (!check) return;
    const input = { person, tribe, accept: warnings.map((w) => w.code), reason, agreed, told: agreed, move: isMove };
    if (asking) {
      await d.go(
        "ask",
        async () => {
          const r = await officeAskAction(input);
          if (r.ok) setReceipt({ kind: "asked" });
          return r.ok ? { ok: true as const } : r;
        },
        { saved: "Your request has gone to the owner." },
      );
      return;
    }
    await d.go(
      "place",
      async () => {
        const r = await officePlaceAction(input);
        if (r.ok) setReceipt({ kind: "placed", run: r.run, tribe: check.tribe.name });
        return r.ok ? { ok: true as const } : r;
      },
      { saved: `${name} is ${isMove ? "moved" : "placed"}. They have been emailed.` },
    );
  }

  async function undo(run: string) {
    await d.go(
      "undo",
      async () => {
        const r = await undoOneAction(run, person, tribe || undefined);
        if (r.ok) setReceipt({ kind: "undone", restored: r.restored });
        return r.ok ? { ok: true as const } : r;
      },
      { saved: "Undone." },
    );
  }

  if (!fixedTribe && choices.length === 0) {
    return <p className="t-body text-soft">There are no open tribes with a certified leader to {isMove ? "move" : "place"} {name} in.</p>;
  }

  return (
    <div className="flex flex-col gap-4" data-testid="place-one">
      <p className="t-small measure text-soft">
        This {isMove ? "moves" : "places"} {name} the same way a church run places a member: they get the “Your tribe” email with a private link to say yes, hold back their details or look at other tribes, and the leader is told in the same way. You can undo it until the leader has been told.
      </p>
      {mode !== "on" ? (
        <p className="t-small rounded-[var(--radius-control)] bg-gold/20 p-3" data-testid="place-one-off">
          Placement is {mode === "rehearsal" ? "in Rehearsal" : "Off"}. The owner switches it On on the Placement page; until then nobody can be {isMove ? "moved" : "placed"} from here.
        </p>
      ) : null}
      {fixedTribe ? (
        <p className="t-body font-semibold" data-testid="place-one-fixed">
          {isMove ? "Move them to" : "Place them in"} {fixedTribe.name}
        </p>
      ) : (
        <Select label={isMove ? "Move them to" : "Place them in"} value={tribe} onChange={(e) => void choose(e.target.value)} disabled={d.busy !== null || receipt?.kind === "placed"} data-testid="place-one-tribe">
          <option value="">Choose a tribe, best fit first</option>
          {choices.map((o) => (
            <option key={o.tribe} value={o.tribe} disabled={o.removed}>
              {o.name} · {o.leader} · {o.active} of {o.capacity} seats{o.degree === null ? " · no fit score" : ` · ${o.degree}% ${o.label ?? ""}`}
              {o.removed ? " · the church took them out of this tribe" : ""}
            </option>
          ))}
        </Select>
      )}

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
          {check.blockers.length === 0 ? (
            <p className="t-body rounded-[var(--radius-control)] bg-surface p-3" data-testid="place-one-preview">
              {asking
                ? `This goes to the owner, who answers within 7 days. Nothing happens to ${name} until then.`
                : isMove
                  ? `${name} will leave ${check.from?.name ?? "their tribe"} and be placed in ${check.tribe.name}, which ${check.tribe.leader} leads. The leader of ${check.from?.name ?? "their old tribe"} is told they have moved. ${name} is emailed “Your tribe” with a private link to say yes, hold back their details or look at other tribes, and ${check.tribe.leader} is told in the usual way. You can undo the move, which puts their old seat back, until ${check.tribe.leader} has been told.`
                  : `${name} will be placed in ${check.tribe.name}, which ${check.tribe.leader} leads. They are emailed “Your tribe” with a private link to say yes, hold back their details or look at other tribes, and ${check.tribe.leader} is told in the usual way. You can undo it until ${check.tribe.leader} has been told.`}
            </p>
          ) : null}
          {warnings.length > 0 && check.blockers.length === 0 ? (
            <div className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-gold/20 p-4" data-testid="place-one-warnings">
              <p className="font-semibold">{asking ? "Why this needs the owner" : `Before you ${verb.toLowerCase()} them`}</p>
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {warnings.map((w) => (
                  <li key={w.code}>
                    {w.text}
                    {role !== "owner" && w.ownerOnly ? <span className="t-small text-soft"> (only the owner can allow this)</span> : null}
                  </li>
                ))}
              </ul>
              <label className="flex items-start gap-3">
                <input type="checkbox" className="mt-1 h-5 w-5" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
                <span>{asking ? "I have read each of these and I am asking for this anyway." : `I have read each of these and I want to ${verb.toLowerCase()} them anyway.`}</span>
              </label>
              {needsAgreement ? (
                <label className="flex items-start gap-3" data-testid="place-one-agreed">
                  <input type="checkbox" className="mt-1 h-5 w-5" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                  <span>{name} has told me they agree to be matched and placed. This is recorded as your word, with your name and the time; it does not record any agreement from them.</span>
                </label>
              ) : null}
              <Textarea label="Why? (a few words, kept with the placement)" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} rows={2} data-testid="place-one-reason" />
            </div>
          ) : null}
          {receipt === null ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button size="md" variant="solid" loading={d.busy === "place" || d.busy === "ask"} disabled={!ready} onClick={() => void go()} data-testid={asking ? "place-one-ask" : "place-one-go"}>
                {asking ? "Ask the owner" : `${verb} ${name}`}
              </Button>
              {mode === "on" && !blocked && !ready ? <span className="t-small text-soft">Tick the boxes and give a reason to go on.</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {receipt?.kind === "placed" ? (
        <div className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-surface p-4" data-testid="place-one-done">
          <p className="t-body">
            Done. {name} is {isMove ? "moved to" : "placed in"} {receipt.tribe}. They have been emailed{isMove ? ", and the leader of their old tribe has been told" : ""}. You can undo this until the leader of {receipt.tribe} has been told.
            {ownerLink ? (
              <>
                {" "}
                <Link href={`/god/placement/${receipt.run}`} className="font-semibold underline underline-offset-4">Open the placement</Link>.
              </>
            ) : null}
          </p>
          <div>
            <Button size="md" variant="quiet" loading={d.busy === "undo"} onClick={() => void undo(receipt.run)} data-testid="place-one-undo">
              Undo
            </Button>
          </div>
        </div>
      ) : null}
      {receipt?.kind === "asked" ? (
        <p className="t-body rounded-[var(--radius-control)] bg-surface p-4" data-testid="place-one-asked">
          Your request is with the owner. It lapses after 7 days if it is not answered, and you can take it back from this page until then.
        </p>
      ) : null}
      {receipt?.kind === "undone" ? (
        <p className="t-body rounded-[var(--radius-control)] bg-surface p-4" data-testid="place-one-undone">
          Undone. {receipt.restored ? `${name} is back in their old tribe.` : `${name} has no seat in the tribe any more.`}
        </p>
      ) : null}
      <Notice error={d.error} saved={d.saved} />
    </div>
  );
}

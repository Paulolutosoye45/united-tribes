"use client";

import Link from "next/link";
import { useState } from "react";
import { lockGoalAction, unlockGoalAction, unlockRunAction, welcomeSendAction, type Said } from "@/app/(app)/god/appointments/choose-actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import {
  COMMUNITY_TOO_HELP,
  COMMUNITY_TOO_LABEL,
  UNLOCK_PROMISE,
  WELCOME_TICK_LABEL,
  stateLine,
  welcomeLine,
  type UnlockView,
} from "@/lib/god/goal-unlock";

/**
 * "Let them choose", on the owner's screens. The goal of a leader the owner appointed is locked on their Tribe Card. This lets the owner
 * unlock it, so the leader picks from a list on their own card, and lock it again. The same panel is used for one leader, for several
 * ticked at once, and for every leader a bulk run appointed. Nothing here changes how a leader is appointed.
 */

export type ChooseContext = {
  views: Record<string, UnlockView>;
  /** The welcome wording, with the pastor's name and title as they are now, has been approved. */
  approved: boolean;
};

const isOpen = (v: UnlockView) => v.state === "waiting" || v.state === "chosen" || v.state === "changed";

/** The version of the welcome email a leader would get if it were sent now. */
const variantNow = (v: UnlockView): "choose" | "fixed" => (isOpen(v) ? "choose" : "fixed");

// ---------------------------------------------------------------------------
// The panel that asks before unlocking
// ---------------------------------------------------------------------------

function UnlockPanel({
  title,
  careLine,
  approved,
  busy,
  confirm,
  onConfirm,
  onCancel,
  testid,
}: {
  title: string;
  careLine?: string;
  approved: boolean;
  busy: boolean;
  confirm: string;
  onConfirm: (communityToo: boolean, welcome: boolean) => void;
  onCancel: () => void;
  testid: string;
}) {
  const [communityToo, setCommunityToo] = useState(false);
  // On once the pastor's wording is approved; it cannot be ticked before
  const [welcome, setWelcome] = useState(approved);
  return (
    <div className="pop-in flex flex-col gap-3 rounded-[var(--radius-control)] bg-surface px-4 py-4" data-testid={testid}>
      <p className="font-semibold">{title}</p>
      <ul className="t-small flex list-disc flex-col gap-1 pl-5 text-soft">
        {UNLOCK_PROMISE.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      {careLine ? <p className="t-small">{careLine}</p> : null}
      <label className="t-small flex cursor-pointer items-start gap-2">
        <input type="checkbox" className="mt-0.5" data-testid="choose-community" checked={communityToo} onChange={(e) => setCommunityToo(e.target.checked)} />
        <span>
          <strong>{COMMUNITY_TOO_LABEL}.</strong> {COMMUNITY_TOO_HELP}
        </span>
      </label>
      <label className={`t-small flex items-start gap-2 ${approved ? "cursor-pointer" : "opacity-70"}`}>
        <input
          type="checkbox"
          className="mt-0.5"
          data-testid="choose-welcome"
          checked={approved && welcome}
          disabled={!approved}
          onChange={(e) => setWelcome(e.target.checked)}
        />
        <span>
          <strong>{WELCOME_TICK_LABEL}.</strong>{" "}
          {approved ? (
            <>
              It explains the choice and the steps that follow, and is signed by the pastor. <Link href="/god/appointments/welcome" className="font-semibold underline underline-offset-4">Read it</Link>
            </>
          ) : (
            <>
              Not available yet: the pastor’s wording has not been approved.{" "}
              <Link href="/god/appointments/welcome" className="font-semibold underline underline-offset-4">
                Read and approve it
              </Link>
              . Letting them choose works without it.
            </>
          )}
        </span>
      </label>
      <div className="flex gap-3">
        <Button size="md" variant="solid" loading={busy} onClick={() => onConfirm(communityToo, approved && welcome)} data-testid="choose-confirm">
          {confirm}
        </Button>
        <Button size="md" variant="ghost" onClick={onCancel}>
          Not yet
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// On each appointed leader
// ---------------------------------------------------------------------------

export function ChooseCard({
  tribe,
  name,
  ctx,
  selected,
  onSelect,
  names,
}: {
  tribe: string;
  name: string;
  ctx: ChooseContext;
  selected: boolean;
  onSelect: (on: boolean) => void;
  names: Record<string, string>;
}) {
  const d = useDo();
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const v = ctx.views[tribe];
  if (!v) return null;

  const show = (r: Said) => {
    if (r.ok) {
      setSaid(r.message);
      setLines(r.lines);
    }
    return r;
  };
  const sentThisVersion = v.welcome.some((w) => w.variant === variantNow(v));
  const wLine = welcomeLine(v);

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3" data-testid={`choose-${tribe}`} data-state={v.state}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="t-small" data-testid={`choose-line-${tribe}`}>
          {stateLine(v)}
        </p>
        {v.canUnlock || v.canLock ? (
          <label className="t-small flex shrink-0 cursor-pointer items-center gap-2 text-soft">
            <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={`Select ${name} for several at once`} />
            Select
          </label>
        ) : null}
      </div>
      {wLine ? (
        <p className="t-small text-soft" data-testid={`welcome-line-${tribe}`}>
          {wLine}
        </p>
      ) : null}
      {!v.canUnlock && v.why && v.state === "none" ? <p className="t-small text-soft">{v.why}.</p> : null}
      <Notice error={d.error} saved={said} />
      {lines.length > 0 ? (
        <ul className="t-small flex list-disc flex-col gap-1 pl-5 text-soft">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : null}
      {open ? (
        <UnlockPanel
          testid={`choose-panel-${tribe}`}
          title={`Let ${name} choose their goal?`}
          careLine={
            v.careCleared
              ? "They are cleared for sensitive subjects, so sensitive goals can be on their list."
              : "They are not cleared for sensitive subjects, so sensitive goals stay off their list."
          }
          approved={ctx.approved}
          busy={d.busy === `unlock-${tribe}`}
          confirm="Yes, let them choose"
          onCancel={() => setOpen(false)}
          onConfirm={async (communityToo, welcome) => {
            const ok = await d.go(`unlock-${tribe}`, async () => show(await unlockGoalAction([tribe], communityToo, welcome, names)));
            if (ok) setOpen(false);
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {v.canUnlock ? (
            <Button size="sm" variant="quiet" data-testid={`choose-open-${tribe}`} onClick={() => (setOpen(true), setSaid(null), setLines([]), d.clear())}>
              Let them choose
            </Button>
          ) : null}
          {v.canLock ? (
            <Button
              size="sm"
              variant="quiet"
              data-testid={`lock-${tribe}`}
              loading={d.busy === `lock-${tribe}`}
              onClick={() => void d.go(`lock-${tribe}`, async () => show(await lockGoalAction([tribe])))}
            >
              Lock it again
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            data-testid={`welcome-send-${tribe}`}
            disabled={!ctx.approved}
            title={ctx.approved ? undefined : "The pastor’s wording has not been approved yet"}
            loading={d.busy === `welcome-${tribe}`}
            onClick={() => void d.go(`welcome-${tribe}`, async () => show(await welcomeSendAction([tribe], sentThisVersion)))}
          >
            {sentThisVersion ? "Send the welcome email again" : "Send the welcome email"}
          </Button>
        </div>
      )}
      {!ctx.approved && !open ? (
        <p className="t-small text-soft">
          The welcome email is off until the pastor’s wording is approved.{" "}
          <Link href="/god/appointments/welcome" className="font-semibold underline underline-offset-4">
            Read and approve it
          </Link>
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// For several at once
// ---------------------------------------------------------------------------

/** Shows when leaders are ticked. */
export function ChooseBar({ ctx, selected, names, onDone }: { ctx: ChooseContext; selected: string[]; names: Record<string, string>; onDone: () => void }) {
  const d = useDo();
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const canUnlock = selected.filter((t) => ctx.views[t]?.canUnlock);
  const canLock = selected.filter((t) => ctx.views[t]?.canLock);
  if (selected.length === 0 && !said) return null;

  const show = (r: Said) => {
    if (r.ok) {
      setSaid(r.message);
      setLines(r.lines);
    }
    return r;
  };

  return (
    <div className="card flex flex-col gap-3 p-4 sm:sticky sm:top-2 sm:z-10" data-testid="choose-bar">
      {selected.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{selected.length} selected</p>
            {canUnlock.length > 0 ? (
              <Button size="sm" variant="solid" data-testid="choose-bar-unlock" onClick={() => (setOpen(true), setSaid(null), setLines([]), d.clear())}>
                Let {canUnlock.length} choose
              </Button>
            ) : null}
            {canLock.length > 0 ? (
              <Button
                size="sm"
                variant="quiet"
                data-testid="choose-bar-lock"
                loading={d.busy === "lock-many"}
                onClick={() =>
                  void d.go("lock-many", async () => {
                    const r = show(await lockGoalAction(canLock));
                    if (r.ok) onDone();
                    return r;
                  })
                }
              >
                Lock {canLock.length} again
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={onDone}>
              Clear
            </Button>
          </div>
          {canUnlock.length < selected.length && canUnlock.length > 0 ? (
            <p className="t-small text-soft">{selected.length - canUnlock.length} of those cannot be unlocked just now and will be left as they are.</p>
          ) : null}
        </>
      ) : null}
      {open && canUnlock.length > 0 ? (
        <UnlockPanel
          testid="choose-bar-panel"
          title={`Let ${canUnlock.length} ${canUnlock.length === 1 ? "leader" : "leaders"} choose their goal?`}
          approved={ctx.approved}
          busy={d.busy === "unlock-many"}
          confirm={`Yes, let ${canUnlock.length} choose`}
          onCancel={() => setOpen(false)}
          onConfirm={async (communityToo, welcome) => {
            const ok = await d.go("unlock-many", async () => show(await unlockGoalAction(canUnlock, communityToo, welcome, names)));
            if (ok) {
              setOpen(false);
              onDone();
            }
          }}
        />
      ) : null}
      <Notice error={d.error} saved={said} />
      {lines.length > 0 ? (
        <ul className="t-small flex list-disc flex-col gap-1 pl-5 text-soft">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// For a bulk run
// ---------------------------------------------------------------------------

/** On a finished bulk run: let everyone the run appointed choose. */
export function ChooseRun({ run, ctx, tribes }: { run: string; ctx: ChooseContext; tribes: string[] }) {
  const d = useDo();
  const views = tribes.flatMap((t) => (ctx.views[t] ? [ctx.views[t]] : []));
  const canChoose = views.filter(isOpen).length;
  const picked = views.filter((v) => v.state === "chosen" || v.state === "changed").length;
  const sent = views.filter((v) => v.state === "sent").length;
  const canUnlock = views.filter((v) => v.canUnlock).length;
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  return (
    <section aria-labelledby={`choose-run-${run}`} className="card flex flex-col gap-3 p-5" data-testid="choose-run">
      <h3 id={`choose-run-${run}`} className="font-semibold">
        Let everyone in this run choose their goal
      </h3>
      <p className="t-small text-soft">
        Each leader this run appointed would pick from the goals in their own community. Anyone whose card has been sent, or who has members, is skipped and the reason is listed.
      </p>
      {views.length > 0 ? (
        <p className="t-small" data-testid="choose-run-counts">
          {canChoose} can choose now. {picked} {picked === 1 ? "has" : "have"} picked. {sent} {sent === 1 ? "has" : "have"} sent their card.
        </p>
      ) : null}
      <Notice error={d.error} saved={said} />
      {lines.length > 0 ? (
        <ul className="t-small flex list-disc flex-col gap-1 pl-5 text-soft">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : null}
      {open ? (
        <UnlockPanel
          testid="choose-run-panel"
          title="Let everyone this run appointed choose?"
          approved={ctx.approved}
          busy={d.busy === "unlock-run"}
          confirm="Yes, let them all choose"
          onCancel={() => setOpen(false)}
          onConfirm={async (communityToo, welcome) => {
            const ok = await d.go("unlock-run", async () => {
              const r = await unlockRunAction(run, communityToo, welcome);
              if (r.ok) {
                setSaid(r.message);
                setLines(r.lines);
              }
              return r;
            });
            if (ok) setOpen(false);
          }}
        />
      ) : canUnlock > 0 || views.length === 0 ? (
        <div>
          <Button size="sm" variant="quiet" data-testid="choose-run-open" onClick={() => (setOpen(true), setSaid(null), setLines([]), d.clear())}>
            Let them choose
          </Button>
        </div>
      ) : null}
    </section>
  );
}

"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  promptInterviewAction,
  promptLaterAction,
  promptNumberAction,
  promptOfferAction,
  promptPlacementAction,
  promptWhatsappAction,
  type PromptResult,
} from "@/app/(app)/prompt-actions";
import { Crest } from "@/components/brand/Crest";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AGREEMENT_SENTENCE } from "@/lib/matching/wording";
import { PLACED_PROMISES } from "@/lib/placement/wording";
import { LINK_TASKS, PROMPT_WORDS as W, hiddenOn, type PromptTask } from "@/lib/prompt/prompt";

type LinkT = Extract<PromptTask, { href: string }>;

/**
 * The sign-in prompt: one screen on top of the page, with the first thing the person owes and the button that does it. It lives in the page layout, so it is there on
 * whichever page they asked for and goes away to show it again. The database decides what is owed, and what shows is only what it sent; this component holds nothing
 * but what has been closed on this page, so a reload or a second device cannot disagree with the record. "Not now" closes a task for this visit only.
 */
export function SignInPrompt({ tasks, total }: { tasks: PromptTask[]; total: number }) {
  const router = useRouter();
  const path = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const [closed, setClosed] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  const list = tasks.filter((t) => !closed.includes(t.kind));
  const task = list[0] ?? null;
  const open = (task !== null || finished) && !hiddenOn(path);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  // A new task takes the focus, so a screen reader reads it from its title
  useEffect(() => {
    if (open) dialog.current?.querySelector<HTMLElement>("h2[tabindex='-1']")?.focus();
  }, [open, task?.kind, finished]);

  function move(kind: string, note: string | null) {
    setClosed((c) => (c.includes(kind) ? c : [...c, kind]));
    setError(null);
    setFlash(note);
    if (list.length <= 1) {
      // The last one: say so, then give the page back, redrawn from the record
      setFinished(note !== null);
      router.refresh();
    }
  }

  async function act(id: string, fn: () => Promise<PromptResult>) {
    if (busy || !task) return;
    setBusy(id);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) return setError(r.message);
      move(task.kind, r.already ? W.already : W.saved);
    } catch {
      setError(W.problem);
    } finally {
      setBusy(null);
    }
  }

  async function later() {
    if (busy || !task || !task.canSkip) return;
    setBusy("later");
    setError(null);
    try {
      const r = await promptLaterAction(task.kind, "not_now");
      if (!r.ok) return setError(r.message);
      move(task.kind, null);
    } catch {
      setError(W.problem);
    } finally {
      setBusy(null);
    }
  }

  async function openPage(t: LinkT | Extract<PromptTask, { kind: "placement" }>, href: string) {
    if (busy) return;
    setBusy("open");
    try {
      await promptLaterAction(t.kind, "opened");
    } catch {
      /* going to the page is what matters */
    }
    // They are going to do this one: the rest wait, so a second screen does not cover the page they asked for. They are still owed, and come back at the next sign-in.
    setClosed((c) => [...new Set([...c, ...tasks.map((x) => x.kind)])]);
    setBusy(null);
    router.push(href);
  }

  const n = Math.min(Math.max(total - list.length + 1, 1), Math.max(total, 1));

  return (
    <dialog
      ref={dialog}
      className="prompt-dialog"
      aria-labelledby="prompt-title"
      data-testid="signin-prompt"
      data-kind={task?.kind ?? "done"}
      onCancel={(e) => {
        // Escape is "Not now", where Not now is allowed; where it is not, the screen stays
        e.preventDefault();
        if (finished) setFinished(false);
        else if (task?.canSkip) void later();
      }}
    >
      {open ? (
        <div className="flex min-h-full flex-col gap-5 p-6 sm:p-8" data-testid="signin-prompt-body">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <Crest size={24} />
              <span className="t-small font-semibold">{W.site}</span>
            </span>
            {task && total > 1 ? (
              <span className="t-small text-soft" data-testid="signin-prompt-step">
                {W.step(n, total)}
              </span>
            ) : null}
          </div>

          {flash && !finished ? (
            <p role="status" className="t-small rounded-[var(--radius-control)] bg-ink/5 px-4 py-3 font-medium" data-testid="signin-prompt-flash">
              {flash}
            </p>
          ) : null}

          {finished && !task ? (
            <div className="flex flex-col gap-4" data-testid="signin-prompt-finished">
              <h2 id="prompt-title" tabIndex={-1} className="t-heading outline-none">
                {flash ?? W.saved}
              </h2>
              <Button size="lg" fullWidth onClick={() => setFinished(false)} data-testid="signin-prompt-continue">
                Continue
              </Button>
            </div>
          ) : task ? (
            <>
              {task.kind === "placement" ? (
                <Placement t={task} busy={busy} act={act} onOpen={() => void openPage(task, "/tribe")} setError={setError} />
              ) : task.kind === "number" ? (
                <NumberTask t={task} busy={busy} act={act} setError={setError} />
              ) : task.kind === "whatsapp" ? (
                <WhatsApp t={task} busy={busy} act={act} />
              ) : task.kind === "interview" ? (
                <Interview t={task} busy={busy} act={act} />
              ) : task.kind === "leader_offer" ? (
                <Offer t={task} busy={busy} act={act} />
              ) : (
                <LinkTask t={task} busy={busy} onOpen={() => void openPage(task, task.href)} />
              )}

              {error ? (
                <p role="alert" className="t-small rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 font-medium text-danger" data-testid="signin-prompt-error">
                  {error}
                </p>
              ) : null}

              <div className="mt-auto flex flex-col gap-2 border-t border-line pt-4">
                {task.canSkip ? (
                  <>
                    <Button variant="ghost" size="md" fullWidth loading={busy === "later"} onClick={() => void later()} data-testid="signin-prompt-later">
                      {W.later}
                    </Button>
                    <p className="t-small text-center text-soft">{W.laterNote}</p>
                  </>
                ) : (
                  <p className="t-small text-soft" data-testid="signin-prompt-noskip">
                    {W.noLater(task.kind === "placement" ? task.until : null)}
                  </p>
                )}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}

type Act = (id: string, fn: () => Promise<PromptResult>) => Promise<void>;

function Title({ children, id = "prompt-title" }: { children: string; id?: string }) {
  // The focus goes to whichever title is on screen, set by the shell
  return (
    <h2 id={id} tabIndex={-1} className="t-heading outline-none" data-testid="signin-prompt-title">
      {children}
    </h2>
  );
}

function Placement({
  t,
  busy,
  act,
  onOpen,
  setError,
}: {
  t: Extract<PromptTask, { kind: "placement" }>;
  busy: string | null;
  act: Act;
  onOpen: () => void;
  setError: (m: string | null) => void;
}) {
  const [mode, setMode] = useState<"none" | "season" | "call">("none");
  const [window, setWindow] = useState("");
  const [phone, setPhone] = useState("");
  const P = W.placement;
  return (
    <div className="flex flex-col gap-5" data-testid="signin-prompt-placement">
      <div className="flex flex-col gap-2">
        <Title>{P.title(t.tribe)}</Title>
        <p className="t-body">{P.body(t.leaderFirst)}</p>
        {t.meets ? <p className="t-body">{P.meets(t.meets)}</p> : null}
        <p className="t-small text-soft">{t.until ? P.held(t.until) : P.holdOpen}</p>
      </div>

      <div className="flex flex-col gap-2">
        <Button size="lg" fullWidth loading={busy === "yes"} onClick={() => void act("yes", () => promptPlacementAction("yes"))} data-testid="signin-prompt-yes">
          {P.yes}
        </Button>
        <p className="t-small text-soft">
          {PLACED_PROMISES.confirm} {AGREEMENT_SENTENCE}
        </p>
      </div>

      {t.moreAnswers ? (
        <div className="flex flex-col gap-3">
          {mode === "season" ? (
            <div className="card flex flex-col gap-3 p-4" data-testid="signin-prompt-season-confirm">
              <p className="t-body">{P.notSeasonNote}</p>
              <Button size="md" variant="quiet" fullWidth loading={busy === "season"} onClick={() => void act("season", () => promptPlacementAction("not_season"))} data-testid="signin-prompt-season-yes">
                {P.notSeason}
              </Button>
              <Button size="sm" variant="ghost" fullWidth onClick={() => setMode("none")}>
                Go back
              </Button>
            </div>
          ) : mode === "call" ? (
            <form
              className="card flex flex-col gap-3 p-4"
              data-testid="signin-prompt-call-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!t.hasNumber && !phone.trim()) return setError(P.needNumber);
                void act("call", () => promptPlacementAction("call", { window: window || null, phone: t.hasNumber ? null : phone }));
              }}
            >
              <p className="t-body">{P.callNote}</p>
              <label className="flex flex-col gap-1.5 text-[0.95rem] font-medium">
                {P.callWindow}
                <select className="input" value={window} onChange={(e) => setWindow(e.target.value)} data-testid="signin-prompt-call-window">
                  {P.windows.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label}
                    </option>
                  ))}
                </select>
              </label>
              {t.hasNumber ? null : <Input label={P.callNumber} type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="signin-prompt-call-number" />}
              <Button type="submit" size="md" variant="quiet" fullWidth loading={busy === "call"} data-testid="signin-prompt-call-send">
                {P.sendCall}
              </Button>
              <Button type="button" size="sm" variant="ghost" fullWidth onClick={() => setMode("none")}>
                Go back
              </Button>
            </form>
          ) : (
            <div className="flex flex-col gap-2">
              <Button size="md" variant="quiet" fullWidth onClick={() => setMode("call")} data-testid="signin-prompt-call">
                {P.call}
              </Button>
              <Button size="md" variant="quiet" fullWidth onClick={() => setMode("season")} data-testid="signin-prompt-season">
                {P.notSeason}
              </Button>
            </div>
          )}
        </div>
      ) : null}

      <p className="t-small text-soft">
        {P.choice}{" "}
        <button type="button" className="min-h-11 font-semibold underline underline-offset-4" onClick={onOpen} data-testid="signin-prompt-tribe-page">
          {P.changeTribe}
        </button>
      </p>
    </div>
  );
}

function NumberTask({ t, busy, act, setError }: { t: Extract<PromptTask, { kind: "number" }>; busy: string | null; act: Act; setError: (m: string | null) => void }) {
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState(false);
  const N = W.number;
  return (
    <form
      className="flex flex-col gap-4"
      data-testid="signin-prompt-number"
      onSubmit={(e) => {
        e.preventDefault();
        if (!phone.trim()) return setError(N.needNumber);
        void act("number", () => promptNumberAction({ phone, useSignin: false, whatsapp }));
      }}
    >
      <div className="flex flex-col gap-2">
        <Title>{N.title}</Title>
        <p className="t-body">{N.body}</p>
      </div>
      <Input label={N.label} type="tel" inputMode="tel" autoComplete="tel" placeholder={N.placeholder} value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="signin-prompt-phone" />
      {/* Nothing is ticked for anyone: the yes to WhatsApp is its own choice */}
      <label className="flex min-h-11 items-start gap-3">
        <input type="checkbox" className="mt-1 size-5" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} data-testid="signin-prompt-whatsapp-tick" />
        <span className="t-body">
          {N.whatsapp}
          <span className="t-small block text-soft">{N.whatsappNote}</span>
        </span>
      </label>
      <Button type="submit" size="lg" fullWidth loading={busy === "number"} data-testid="signin-prompt-save-number">
        {N.save}
      </Button>
      {t.signinMask ? (
        <Button type="button" size="md" variant="quiet" fullWidth loading={busy === "signin"} onClick={() => void act("signin", () => promptNumberAction({ phone: "", useSignin: true, whatsapp }))} data-testid="signin-prompt-use-signin">
          {N.signin(t.signinMask)}
        </Button>
      ) : null}
    </form>
  );
}

function WhatsApp({ t, busy, act }: { t: Extract<PromptTask, { kind: "whatsapp" }>; busy: string | null; act: Act }) {
  const X = W.whatsapp;
  return (
    <div className="flex flex-col gap-4" data-testid="signin-prompt-whatsapp">
      <div className="flex flex-col gap-2">
        <Title>{X.title}</Title>
        <p className="t-body">{X.body(t.numberMask)}</p>
      </div>
      <Button size="lg" fullWidth loading={busy === "wa-yes"} onClick={() => void act("wa-yes", () => promptWhatsappAction(true))} data-testid="signin-prompt-wa-yes">
        {X.yes}
      </Button>
      <div className="flex flex-col gap-2">
        <Button size="md" variant="quiet" fullWidth loading={busy === "wa-no"} onClick={() => void act("wa-no", () => promptWhatsappAction(false))} data-testid="signin-prompt-wa-no">
          {X.no}
        </Button>
        <p className="t-small text-soft">{X.noNote}</p>
      </div>
    </div>
  );
}

function Interview({ t, busy, act }: { t: Extract<PromptTask, { kind: "interview" }>; busy: string | null; act: Act }) {
  const I = W.interview;
  return (
    <div className="flex flex-col gap-4" data-testid="signin-prompt-interview">
      <div className="flex flex-col gap-2">
        <Title>{I.title}</Title>
        <p className="t-body">{I.body}</p>
      </div>
      <ul className="flex flex-col gap-2">
        {t.options.map((o) => (
          <li key={o.id} className="card flex flex-col gap-2 p-4">
            <span className="t-body font-semibold">{o.when}</span>
            <Button size="md" variant="quiet" fullWidth loading={busy === o.id} onClick={() => void act(o.id, () => promptInterviewAction(o.id))} data-testid="signin-prompt-slot">
              {I.book}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Offer({ t, busy, act }: { t: Extract<PromptTask, { kind: "leader_offer" }>; busy: string | null; act: Act }) {
  const O = W.leader_offer;
  return (
    <div className="flex flex-col gap-4" data-testid="signin-prompt-offer">
      <div className="flex flex-col gap-2">
        <Title>{O.title}</Title>
        {O.body(t.goal, t.community) ? <p className="t-body">{O.body(t.goal, t.community)}</p> : null}
        {t.until ? <p className="t-small font-semibold">{O.until(t.until)}</p> : null}
        <p className="t-small text-soft">{O.note}</p>
      </div>
      <Button size="lg" fullWidth loading={busy === "offer-yes"} onClick={() => void act("offer-yes", () => promptOfferAction(t.offerId, true))} data-testid="signin-prompt-offer-yes">
        {O.yes}
      </Button>
      <Button size="md" variant="quiet" fullWidth loading={busy === "offer-no"} onClick={() => void act("offer-no", () => promptOfferAction(t.offerId, false))} data-testid="signin-prompt-offer-no">
        {O.no}
      </Button>
    </div>
  );
}

function LinkTask({ t, busy, onOpen }: { t: LinkT; busy: string | null; onOpen: () => void }) {
  const L = W.links[t.kind];
  // The page a task may open is fixed by its kind, whatever the database said
  const href = LINK_TASKS[t.kind];
  const body = t.kind === "care" ? W.care(t.count) : t.kind === "tribe_card" && t.changesAsked ? W.tribeCardChanges : L.body;
  return (
    <div className="flex flex-col gap-4" data-testid={`signin-prompt-${t.kind}`} data-href={href}>
      <div className="flex flex-col gap-2">
        <Title>{L.title}</Title>
        <p className="t-body">{body}</p>
      </div>
      <Button size="lg" fullWidth loading={busy === "open"} onClick={onOpen} data-testid="signin-prompt-open">
        {W.open}
      </Button>
    </div>
  );
}

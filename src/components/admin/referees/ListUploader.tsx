"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { PreviewList } from "@/components/admin/referees/PreviewList";
import { Button } from "@/components/ui/Button";
import { Choice } from "@/components/ui/Choice";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";
import { STANDINGS, STANDING_LABEL, type Standing } from "@/lib/leaders/referee/labels";
import type { PlanCounts, Preview } from "@/lib/leaders/referee/types";
import {
  COLUMN_WORD, applyLabel, doneLine, fileProblem, needsRetireConfirm, nothingToDo, retireLimit,
  type Failure, type ReadAnswer,
} from "@/lib/leaders/referee/upload";

type Mode = "update" | "replace";

type Phase =
  | { name: "idle"; note?: string; error?: string }
  | { name: "reading"; file: File }
  | { name: "review"; file: File; data: ReadAnswer; mode: Mode; fallback: Standing | ""; sheet: string | null; busy: null | "mode" | "reread" | "apply"; force: boolean; error: string | null }
  | { name: "done"; counts: PlanCounts; filename: string; batch: string | null; nothing: boolean; busy: boolean; error: string | null };

const NETWORK = "We couldn’t reach the server. Check your connection and try again.";

/** Sends a request and always comes back with an answer a person can read, even when the host answers with a page instead of data. */
async function send<T extends { ok: true }>(url: string, init: RequestInit): Promise<T | Failure> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, credentials: "same-origin" });
  } catch {
    return { ok: false, message: NETWORK };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // not data
  }
  const b = body as { ok?: boolean; message?: string } | null;
  if (res.ok && b && b.ok === true) return body as T;
  if (b && typeof b.message === "string") return { ok: false, message: b.message };
  if (res.status === 401) return { ok: false, message: "Your session ended. Sign in again, then choose the file again." };
  if (res.status === 413) return { ok: false, message: "That file is too large. A list of people should be well under 4 MB." };
  return { ok: false, message: "Something went wrong on our side. Please try again in a moment." };
}

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/**
 * The pastors' spreadsheet, uploaded from here. Choose or drop the file; see exactly what it would change, person by person;
 * then apply it. Nothing changes until "Apply" is pressed, and the latest upload can be undone. The same file can be uploaded as
 * often as the list changes: people are matched by their phone number or email, so nobody is added twice.
 */
export function ListUploader({ activeNow }: { activeNow: number }) {
  const router = useRouter();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [over, setOver] = useState(false);
  const locked = phase.name === "reading" || (phase.name === "review" && phase.busy !== null) || (phase.name === "done" && phase.busy);

  // A file dropped beside the box would make the browser open it and leave this page, losing the preview
  useEffect(() => {
    const stop = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);

  // After a file is read, the person is at the top of what they need to check
  useEffect(() => {
    if (phase.name === "review" && phase.busy === null) heading.current?.focus({ preventScroll: false });
  }, [phase.name === "review" ? phase.file : null]); // eslint-disable-line react-hooks/exhaustive-deps

  const read = useCallback(async (file: File, opts: { mode: Mode; sheet: string | null; fallback: Standing | "" }, previous?: Extract<Phase, { name: "review" }>) => {
    const form = new FormData();
    form.set("file", file);
    form.set("mode", opts.mode);
    if (opts.sheet) form.set("sheet", opts.sheet);
    if (opts.fallback) form.set("fallback", opts.fallback);
    const out = await send<ReadAnswer>("/api/referees/read", { method: "POST", body: form });
    if (!out.ok) {
      if (previous) setPhase({ ...previous, busy: null, error: out.message });
      else setPhase({ name: "idle", error: out.message });
      return;
    }
    setPhase({ name: "review", file, data: out, mode: out.mode, fallback: opts.fallback, sheet: out.file.sheet, busy: null, force: false, error: null });
  }, []);

  function choose(file: File | undefined | null) {
    if (!file || locked) return;
    const problem = fileProblem(file);
    if (problem) return setPhase({ name: "idle", error: problem });
    setPhase({ name: "reading", file });
    void read(file, { mode: "update", sheet: null, fallback: "" });
  }

  async function changeMode(mode: Mode) {
    if (phase.name !== "review" || phase.busy || phase.mode === mode) return;
    const was = phase;
    setPhase({ ...was, mode, busy: "mode", error: null, force: false });
    const out = await send<{ ok: true; preview: Preview }>("/api/referees/preview", json({ rows: was.data.clean, mode }));
    setPhase(out.ok ? { ...was, mode, data: { ...was.data, mode, preview: out.preview }, busy: null, force: false, error: null } : { ...was, busy: null, error: out.message });
  }

  async function reread(next: { sheet?: string | null; fallback?: Standing | "" }) {
    if (phase.name !== "review" || phase.busy) return;
    const was = phase;
    const opts = { mode: was.mode, sheet: next.sheet !== undefined ? next.sheet : was.sheet, fallback: next.fallback !== undefined ? next.fallback : was.fallback };
    setPhase({ ...was, busy: "reread", error: null, fallback: opts.fallback });
    await read(was.file, opts, was);
  }

  async function apply() {
    if (phase.name !== "review" || phase.busy) return;
    const was = phase;
    setPhase({ ...was, busy: "apply", error: null });
    const out = await send<{ ok: true; nothing: boolean; batch: string | null; counts: PlanCounts }>(
      "/api/referees/apply",
      json({ rows: was.data.clean, mode: was.mode, filename: was.file.name, force: was.force }),
    );
    if (!out.ok) return setPhase({ ...was, busy: null, error: out.message });
    setPhase({ name: "done", counts: out.counts, filename: was.file.name, batch: out.batch, nothing: out.nothing, busy: false, error: null });
    router.refresh();
  }

  async function undo() {
    if (phase.name !== "done" || !phase.batch || phase.busy) return;
    const was = phase;
    setPhase({ ...was, busy: true, error: null });
    const out = await send<{ ok: true }>("/api/referees/undo", json({ batch: was.batch }));
    if (!out.ok) return setPhase({ ...was, busy: false, error: out.message });
    setPhase({ name: "idle", note: "Done. The list is back as it was before that upload." });
    router.refresh();
  }

  const zone = (children: React.ReactNode, tone: "calm" | "busy" = "calm") => (
    <label
      htmlFor={inputId}
      className={cn(
        "flex cursor-pointer flex-col items-center gap-3 rounded-[var(--radius-sheet)] border-2 border-dashed px-5 py-10 text-center transition-[border-color,background-color] duration-200",
        "has-[:focus-visible]:border-ink has-[:focus-visible]:shadow-[0_0_0_4px_color-mix(in_srgb,var(--crest-gold)_45%,transparent)]",
        over ? "border-ink bg-gold/20" : "border-line bg-surface hover:border-soft",
        tone === "busy" && "cursor-progress",
      )}
    >
      {children}
    </label>
  );

  return (
    <section
      aria-labelledby="upload-h"
      className="card flex flex-col gap-5 p-5 sm:p-7"
      data-testid="uploader"
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes("Files") && !locked) setOver(true);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        choose(e.dataTransfer.files?.[0]);
      }}
    >
      <header className="flex flex-col gap-1">
        <h2 id="upload-h" className="t-heading">
          Upload the list
        </h2>
        <p className="t-small measure text-soft">
          Upload your spreadsheet of pastors and unit heads, and upload it again whenever it changes. People already on the list are matched by phone number or email, so nobody is added twice. You see exactly what will change before anything does.
        </p>
      </header>

      <input
        ref={input}
        id={inputId}
        type="file"
        accept=".xlsx,.xlsm,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        data-testid="file-input"
        disabled={Boolean(locked)}
        onChange={(e) => {
          choose(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {phase.name === "idle" ? (
        <>
          {phase.note ? (
            <p role="status" className="t-small rounded-[var(--radius-control)] bg-gold/20 px-4 py-3 text-ink">
              {phase.note}
            </p>
          ) : null}
          {phase.error ? (
            <p role="alert" className="t-small rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-danger" data-testid="upload-error">
              {phase.error}
            </p>
          ) : null}
          {zone(
            <>
              <UploadIcon />
              <span className="t-heading">{over ? "Drop it here" : "Drop your spreadsheet here"}</span>
              <span className="t-small text-soft">or tap to choose a file. Excel (.xlsx) or CSV.</span>
              <span className="btn-quiet btn mt-1 inline-flex h-12 items-center rounded-[var(--radius-control)] px-5 text-[0.95rem] font-medium">Choose a file</span>
            </>,
          )}
        </>
      ) : null}

      {phase.name === "reading"
        ? zone(
            <div role="status" className="flex flex-col items-center gap-3" data-testid="upload-reading">
              <Spinner size={28} />
              <span className="t-heading">Reading {phase.file.name}…</span>
              <span className="t-small text-soft">Finding the columns and checking each person against the list.</span>
            </div>,
            "busy",
          )
        : null}

      {phase.name === "review" ? <Review phase={phase} activeNow={activeNow} headingRef={heading} onMode={changeMode} onReread={reread} onApply={apply} onChoose={() => input.current?.click()} onCancel={() => setPhase({ name: "idle" })} setForce={(force) => setPhase({ ...phase, force })} /> : null}

      {phase.name === "done" ? (
        <div className="flex flex-col gap-4" data-testid="upload-done">
          <div role="status" className="flex items-start gap-3 rounded-[var(--radius-control)] bg-gold/20 px-4 py-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
              <path d="m7.5 12.5 3 3 6-6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="flex flex-col gap-1">
              <p className="font-semibold">{phase.nothing ? "Nothing needed changing." : "The list is updated."}</p>
              <p className="t-small" data-testid="done-line">
                {phase.nothing ? `The list already matches ${phase.filename}.` : doneLine(phase.counts)}
              </p>
              {!phase.nothing ? <p className="t-small text-soft">People who had already confirmed their phone or email have been checked against the new list straight away.</p> : null}
            </div>
          </div>
          {phase.error ? (
            <p role="alert" className="t-small rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-danger">
              {phase.error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button size="md" onClick={() => setPhase({ name: "idle" })} data-testid="upload-another">
              Upload another file
            </Button>
            {phase.batch ? (
              <Button size="md" variant="quiet" loading={phase.busy} onClick={() => void undo()} data-testid="upload-undo">
                Undo this upload
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <Downloads />
    </section>
  );
}

function Review({
  phase, activeNow, headingRef, onMode, onReread, onApply, onChoose, onCancel, setForce,
}: {
  phase: Extract<Phase, { name: "review" }>;
  activeNow: number;
  headingRef: React.RefObject<HTMLDivElement | null>;
  onMode: (m: Mode) => void;
  onReread: (n: { sheet?: string | null; fallback?: Standing | "" }) => void;
  onApply: () => void;
  onChoose: () => void;
  onCancel: () => void;
  setForce: (v: boolean) => void;
}) {
  const { data, mode, busy } = phase;
  const { file, preview } = data;
  const counts = preview.counts;
  const confirmRetire = needsRetireConfirm(counts, preview.activeNow || activeNow);
  const blocked = confirmRetire && !phase.force;
  const none = nothingToDo(counts);
  const tiles: { key: string; label: string; n: number; note: string }[] = [
    { key: "add", label: "New", n: counts.add, note: "added to the list" },
    { key: "update", label: "Updated", n: counts.update, note: "details changed" },
    { key: "unchanged", label: "Unchanged", n: counts.unchanged, note: "already right" },
    { key: "retire", label: "Taken off", n: counts.retire, note: "no longer listed" },
    { key: "error", label: "Can’t use", n: counts.error, note: "left out" },
  ];

  return (
    <div className="flex flex-col gap-6" data-testid="upload-review" aria-busy={busy !== null}>
      <div ref={headingRef} tabIndex={-1} className="flex flex-wrap items-start justify-between gap-3 outline-none">
        <div className="min-w-0">
          <p className="t-small text-soft">Reading</p>
          <p className="break-words font-semibold" data-testid="file-name">
            {file.name}
          </p>
          <p className="t-small text-soft">
            {file.type === "xlsx" ? "Excel" : "CSV"}
            {file.type === "xlsx" ? ` · sheet “${data.file.sheet}”` : ""} · {data.file.people.toLocaleString("en-NG")} {data.file.people === 1 ? "person" : "people"} found
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onChoose} disabled={busy !== null}>
          Choose a different file
        </Button>
      </div>

      {data.file.sheets.length > 1 ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sheet-pick" className="t-small font-medium">
            This file has several sheets. Use:
          </label>
          <select
            id="sheet-pick"
            value={data.file.sheet}
            disabled={busy !== null}
            onChange={(e) => onReread({ sheet: e.target.value })}
            className="h-12 w-full max-w-sm rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base focus:border-ink focus:outline-none"
          >
            {data.file.sheets.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} ({s.people})
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <details className="group rounded-[var(--radius-control)] border border-line bg-surface px-4 py-3">
        <summary className="t-small cursor-pointer list-none font-semibold">
          How we read your columns <span className="font-normal text-soft">({data.file.columns.length} recognised)</span>
        </summary>
        <div className="mt-3 flex flex-col gap-2">
          <ul className="flex flex-wrap gap-2">
            {data.file.columns.map((c, i) => (
              <li key={`${c.header}-${i}`} className="rounded-full bg-raised px-3 py-1 text-[0.85rem]">
                {c.header} <span className="text-soft">→ {COLUMN_WORD[c.field] ?? c.field}</span>
              </li>
            ))}
          </ul>
          {data.file.ignored.length > 0 ? <p className="t-small text-soft">Not used: {data.file.ignored.join(", ")}.</p> : null}
          {data.file.skipped.length > 0 ? <p className="t-small text-soft">{data.file.skipped.length} example {data.file.skipped.length === 1 ? "row was" : "rows were"} left out.</p> : null}
        </div>
      </details>

      {data.file.rolesMissing ? (
        <div className="flex flex-col gap-2 rounded-[var(--radius-control)] bg-gold/15 px-4 py-3" data-testid="role-fallback">
          <label htmlFor="fallback-pick" className="t-small font-semibold">
            Some rows have no role we can read. Treat them as:
          </label>
          <select
            id="fallback-pick"
            value={phase.fallback}
            disabled={busy !== null}
            onChange={(e) => onReread({ fallback: e.target.value as Standing | "" })}
            className="h-12 w-full max-w-sm rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base focus:border-ink focus:outline-none"
          >
            <option value="">Leave them out. I’ll fix the sheet</option>
            {STANDINGS.map((s) => (
              <option key={s} value={s}>
                {STANDING_LABEL[s]}
              </option>
            ))}
          </select>
          <p className="t-small text-soft">Only people marked Pastor or Unit head count as the pastor or unit head every application needs. Choose carefully.</p>
        </div>
      ) : null}

      <fieldset className="flex flex-col gap-3" disabled={busy !== null}>
        <legend className="t-small mb-1 font-semibold">How should this file be used?</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Choice name="mode" value="update" checked={mode === "update"} onChange={() => onMode("update")} title="Add and update" description="Adds new people and updates the ones in the file. Nobody is taken off." badge="Usual" />
          <Choice name="mode" value="replace" checked={mode === "replace"} onChange={() => onMode("replace")} title="Replace the list" description="This file is the whole list. Anyone who isn’t in it is taken off. You can undo it." />
        </div>
      </fieldset>

      <div className="flex flex-col gap-3" aria-live="polite">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="counts">
          {tiles.map((t) => (
            <div key={t.key} className={cn("flex flex-col gap-0.5 rounded-[var(--radius-control)] border border-line bg-raised px-3 py-2.5", busy === "mode" && "opacity-60", t.key === "error" && t.n > 0 && "border-danger/50")}>
              <dt className="t-small text-soft">{t.label}</dt>
              <dd className="t-heading tabular-nums" data-testid={`count-${t.key}`}>
                {t.n}
              </dd>
            </div>
          ))}
        </dl>
        {counts.error > 0 ? (
          <p role="note" className="t-small rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-danger">
            {counts.error} {counts.error === 1 ? "row can’t" : "rows can’t"} be used and will be left out. Fix {counts.error === 1 ? "it" : "them"} in your spreadsheet and upload again, or carry on with the rest.
          </p>
        ) : null}
      </div>

      <PreviewList key={`${file.name}-${mode}-${counts.total}-${counts.error}-${counts.add}-${counts.update}-${counts.retire}`} rows={preview.rows} counts={counts} roleTexts={data.roleTexts} />

      {confirmRetire ? (
        <div className="flex flex-col gap-3 rounded-[var(--radius-control)] border-[1.5px] border-flame bg-flame/10 px-4 py-4" role="alert" data-testid="retire-confirm">
          <p className="font-semibold">
            This would take {counts.retire} of the {preview.activeNow} people off the list.
          </p>
          <p className="t-small text-soft">That is more than {retireLimit(preview.activeNow)}, so we are checking it is what you meant. A file with the wrong people in it is the usual reason. Nobody is deleted, and you can undo it.</p>
          <label className="flex min-h-11 items-center gap-3 text-[0.95rem]">
            <input type="checkbox" checked={phase.force} onChange={(e) => setForce(e.target.checked)} className="size-5 accent-[var(--crest-flame)]" data-testid="retire-checkbox" />
            Yes, take {counts.retire} {counts.retire === 1 ? "person" : "people"} off the list
          </label>
        </div>
      ) : null}

      {phase.error ? (
        <p role="alert" className="t-small rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-danger" data-testid="upload-error">
          {phase.error}
        </p>
      ) : null}

      <div className="sticky bottom-3 z-10 flex flex-wrap gap-3 rounded-[var(--radius-sheet)] bg-page/90 py-2 backdrop-blur-sm sm:static sm:bg-transparent sm:py-0 sm:backdrop-blur-none">
        <Button size="lg" loading={busy === "apply"} disabled={none || blocked || busy === "mode" || busy === "reread"} onClick={onApply} data-testid="upload-apply" className="flex-1 sm:flex-none sm:px-10">
          {none ? "Nothing to change" : counts.error > 0 ? `${applyLabel(counts)} · skip ${counts.error}` : applyLabel(counts)}
        </Button>
        <Button size="lg" variant="quiet" disabled={busy !== null} onClick={onCancel} data-testid="upload-cancel">
          Cancel
        </Button>
      </div>
    </div>
  );
}

function UploadIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 48 48" fill="none" aria-hidden="true" className="text-soft">
      <rect x="9" y="6" width="30" height="36" rx="5" stroke="currentColor" strokeWidth="2.2" />
      <path d="M24 33V17m0 0-6 6m6-6 6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Downloads() {
  const link = "font-semibold text-accent underline underline-offset-4";
  return (
    <div className="t-small flex flex-col gap-1.5 border-t border-line pt-4 text-soft">
      <p>
        <strong className="font-semibold text-ink">Starting a new sheet?</strong> Download the template:{" "}
        <a className={link} href="/api/referees/file?kind=template&format=xlsx" download data-testid="dl-template-xlsx">
          Excel
        </a>{" "}
        or{" "}
        <a className={link} href="/api/referees/file?kind=template&format=csv" download>
          CSV
        </a>
        . Any column titles work. We find Name, Role, Unit, Phone and Email ourselves.
      </p>
      <p>
        <strong className="font-semibold text-ink">Editing what’s there?</strong> Download the current list:{" "}
        <a className={link} href="/api/referees/file?kind=export&format=xlsx" download data-testid="dl-export-xlsx">
          Excel
        </a>{" "}
        or{" "}
        <a className={link} href="/api/referees/file?kind=export&format=csv" download>
          CSV
        </a>
        . Change it and upload it back.
      </p>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { prepareAction, withdrawAction } from "@/app/(app)/exports/actions";
import { Notice } from "@/components/admin/Notice";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Choice } from "@/components/ui/Choice";
import { Select } from "@/components/ui/Input";
import { fileHref, nameFromDisposition, printHref } from "@/lib/exports/links";
import { FORMAT_NAMES, LANE_NAMES, packInfo } from "@/lib/exports/registry";
import { PURPOSE_LINES } from "@/lib/exports/purposes";
import type { Format, OptionPack, Options, PurposeKey, Scope } from "@/lib/exports/types";
import { PEOPLE_PROMISES, SEASON_PACKS, lagosWhen } from "@/lib/exports/wording";
import { TRY_AGAIN } from "@/lib/leaders/errors";

type Initial = { pack?: string | null; tribe?: string | null; community?: string | null; season?: string | null };

type Made = { token: string; exportId: string; expiresAt: string; rehearsal: boolean; format: Format; name: string | null; packName: string };

const GROUPS: { scopes: Scope[]; title: string }[] = [
  { scopes: ["tribe"], title: "For a tribe you lead" },
  { scopes: ["tribes"], title: "Across your tribes" },
  { scopes: ["community"], title: "For a community you champion" },
  { scopes: ["church"], title: "Across the church" },
];

/**
 * The Export Studio: choose a file, check what it is, get it. It shows only what the church has opened to this person's role (the
 * database leaves everything else out of the list), and it says plainly what a named file is for. A file is made on request, from
 * the figures as they are now, and nothing is stored: the link lasts 24 hours and only works for this account.
 */
export function ExportStudio({ options, initial, canFeeds }: { options: Options; initial: Initial; canFeeds: boolean }) {
  const first = options.packs.find((p) => p.id === initial.pack) ?? (options.packs.length === 1 ? options.packs[0] : null);
  const [packId, setPackId] = useState<string | null>(first?.id ?? null);
  const pack = options.packs.find((p) => p.id === packId) ?? null;
  const [target, setTarget] = useState<string>(() => preset(first, initial));
  const [format, setFormat] = useState<Format | null>(first?.formats[0] ?? null);
  const [season, setSeason] = useState(initial.season && options.seasons.some((s) => s.id === initial.season) ? initial.season : "");
  const [purpose, setPurpose] = useState<PurposeKey | "">("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState<"make" | "again" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [made, setMade] = useState<Made | null>(null);

  function choose(p: OptionPack) {
    setPackId(p.id);
    setTarget(preset(p, initial));
    setFormat(p.formats[0] ?? null);
    setPurpose("");
    setAck(false);
    setMade(null);
    setError(null);
    setNote(null);
  }

  const people = pack?.lane === "people";
  const needsTarget = !!pack?.targets && pack.targets.length > 0;
  const ready = !!pack && !!format && (!needsTarget || !!target) && (!people || (!!purpose && ack));

  async function save(token: string, fallback: string): Promise<string> {
    const res = await fetch(fileHref(token), { cache: "no-store", credentials: "same-origin" });
    if (!res.ok) {
      let message = TRY_AGAIN;
      try {
        const body = (await res.json()) as { message?: unknown };
        if (typeof body.message === "string" && body.message.length <= 200) message = body.message;
      } catch {
        /* keep the general message */
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    const name = nameFromDisposition(res.headers.get("content-disposition"), fallback);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15_000);
    return name;
  }

  async function make() {
    if (!pack || !format || busy) return;
    setBusy("make");
    setError(null);
    setNote(null);
    setMade(null);
    try {
      const r = await prepareAction({
        pack: pack.id,
        format,
        purpose: people ? purpose || null : null,
        tribe: pack.scope === "tribe" ? target : null,
        community: pack.scope === "community" ? target : null,
        season: season && SEASON_PACKS.includes(pack.id) ? season : null,
      });
      if (!r.ok) {
        setError(r.message);
        return;
      }
      const base: Made = { token: r.token, exportId: r.exportId, expiresAt: r.expiresAt, rehearsal: r.rehearsal, format, name: null, packName: pack.name };
      if (format === "pdf") {
        setMade(base);
        return;
      }
      try {
        const name = await save(r.token, `united-tribes-${pack.id}.${format === "csv" ? "zip" : "xlsx"}`);
        setMade({ ...base, name });
      } catch (e) {
        setError(e instanceof Error ? e.message : TRY_AGAIN);
      }
    } catch {
      setError("We couldn’t make that. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function again() {
    if (!made || !made.name || busy) return;
    setBusy("again");
    setError(null);
    try {
      await save(made.token, made.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : TRY_AGAIN);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!made || busy) return;
    setBusy("delete");
    setError(null);
    try {
      const r = await withdrawAction(made.exportId);
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setMade(null);
      setNote("Deleted. The link no longer works. Nothing was stored on our side, so there is nothing else to remove. Delete the copy you saved too.");
    } catch {
      setError(TRY_AGAIN);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-10" data-testid="export-studio">
      <section aria-labelledby="choose-heading" className="flex flex-col gap-5">
        <Step n={1} id="choose-heading" title="Choose a file" line="Only what the church has opened to your role is listed." />
        {GROUPS.map((g) => {
          const list = options.packs.filter((p) => g.scopes.includes(p.scope));
          if (list.length === 0) return null;
          return (
            <div key={g.title} className="flex flex-col gap-3">
              <h3 className="t-small font-semibold uppercase tracking-wide text-soft">{g.title}</h3>
              <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={g.title}>
                {list.map((p) => (
                  <Choice
                    key={p.id}
                    name="pack"
                    value={p.id}
                    checked={packId === p.id}
                    onChange={() => choose(p)}
                    title={p.name}
                    description={packInfo(p.id)?.line}
                    badge={p.lane === "people" ? "People" : p.rehearsal ? "Rehearsal" : undefined}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {pack ? (
        <section aria-labelledby="check-heading" className="flex flex-col gap-5" data-testid="export-check">
          <Step n={2} id="check-heading" title="Check it" line={LANE_NAMES[pack.lane].line} />
          {pack.rehearsal ? (
            <p role="note" className="t-small rounded-[var(--radius-control)] bg-gold/30 px-4 py-3 font-medium">
              This file is being tried by a few people. It will say REHEARSAL on every page. Please do not rely on it or pass it on.
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            {needsTarget ? (
              <Select label={pack.scope === "community" ? "Community" : "Tribe"} value={target} onChange={(e) => setTarget(e.target.value)} data-testid="export-target">
                {pack.targets!.length > 1 ? <option value="">Choose one</option> : null}
                {pack.targets!.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.community && pack.scope === "tribe" ? ` · ${t.community}` : ""}
                  </option>
                ))}
              </Select>
            ) : null}
            {SEASON_PACKS.includes(pack.id) && options.seasons.length > 0 ? (
              <Select label="Season" value={season} onChange={(e) => setSeason(e.target.value)}>
                <option value="">The current season</option>
                {options.seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            ) : null}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-[0.95rem] font-medium">Format</legend>
              <div className="flex flex-wrap gap-2">
                {pack.formats.map((f) => (
                  <label key={f} className={`press inline-flex min-h-12 cursor-pointer items-center rounded-[var(--radius-control)] border-[1.5px] px-4 text-[0.95rem] font-medium ${format === f ? "border-ink bg-surface-strong" : "border-line hover:border-soft"}`}>
                    <input type="radio" name="format" value={f} checked={format === f} onChange={() => setFormat(f)} className="sr-only" />
                    {f === "csv" ? "Open Data Pack (zip of CSV files)" : f === "pdf" ? "Printed page (save as PDF)" : FORMAT_NAMES[f]}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          {people ? (
            <div className="flex flex-col gap-4 rounded-[var(--radius-control)] border border-line p-4" data-testid="export-people-check">
              <Select label="Why do you need this file?" value={purpose} onChange={(e) => setPurpose(e.target.value as PurposeKey | "")} data-testid="export-purpose">
                <option value="">Choose a reason</option>
                {options.purposes.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </Select>
              {purpose ? <p className="t-small text-soft">{PURPOSE_LINES[purpose]}</p> : null}
              <Choice type="checkbox" name="ack" value="yes" checked={ack} onChange={(e) => setAck(e.target.checked)} title="I will look after this file" description={PEOPLE_PROMISES.join(" ")} />
            </div>
          ) : null}
        </section>
      ) : null}

      {pack ? (
        <section aria-labelledby="get-heading" className="flex flex-col gap-4" data-testid="export-get">
          <Step n={3} id="get-heading" title="Get it" line="Made now, from the figures as they are today. The link lasts 24 hours and works only in your account." />
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" variant="solid" loading={busy === "make"} disabled={!ready || busy !== null} onClick={() => void make()} data-testid="export-make">
              {format === "pdf" ? "Make the page" : "Make my file"}
            </Button>
            {!ready ? <span className="t-small text-soft">{people && (!purpose || !ack) ? "Choose a reason and confirm above." : needsTarget && !target ? "Choose which one first." : "Choose a file first."}</span> : null}
          </div>
          <Notice error={error} saved={note} />
          {made ? <Result made={made} busy={busy} onAgain={() => void again()} onDelete={() => void remove()} /> : null}
        </section>
      ) : null}

      <footer className="flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-5">
        <Link href="/exports/mine" className="press inline-flex min-h-11 items-center text-[0.95rem] font-medium text-soft hover:text-ink">
          My files
        </Link>
        {canFeeds ? (
          <Link href="/exports/feeds" className="press inline-flex min-h-11 items-center text-[0.95rem] font-medium text-soft hover:text-ink">
            Standing links for reporting tools
          </Link>
        ) : null}
      </footer>
    </div>
  );
}

function preset(p: OptionPack | null, initial: Initial): string {
  if (!p?.targets) return "";
  if (p.targets.length === 1) return p.targets[0].id;
  const want = p.scope === "community" ? initial.community : initial.tribe;
  return want && p.targets.some((t) => t.id === want) ? want : "";
}

function Step({ n, id, title, line }: { n: number; id: string; title: string; line: string }) {
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-[0.9rem] font-semibold text-page">
        {n}
      </span>
      <div>
        <h2 id={id} className="t-heading">
          {title}
        </h2>
        <p className="t-small measure text-soft">{line}</p>
      </div>
    </div>
  );
}

function Result({ made, busy, onAgain, onDelete }: { made: Made; busy: string | null; onAgain: () => void; onDelete: () => void }) {
  const print = made.format === "pdf";
  return (
    <div role="status" className="card flex flex-col gap-3 p-5" data-testid="export-result">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="t-heading">{print ? "Your page is ready" : "Your file is saved"}</h3>
        {made.rehearsal ? <Badge tone="gold">Rehearsal</Badge> : null}
      </div>
      <p className="t-small text-soft">
        {print ? (
          <>The page opens in a new tab. Choose “Print or save as PDF” there.</>
        ) : (
          <>
            <span className="font-medium text-ink">{made.name}</span> was sent to your downloads.
          </>
        )}{" "}
        The link ends {made.expiresAt ? lagosWhen(made.expiresAt) : "in 24 hours"} and works only for you.
      </p>
      <div className="flex flex-wrap gap-3">
        {print ? (
          <a href={printHref(made.token)} target="_blank" rel="noopener noreferrer" className="btn btn-solid inline-flex h-12 items-center rounded-[var(--radius-control)] px-5 font-semibold" data-testid="export-open-print">
            Open the page
          </a>
        ) : (
          <Button size="md" variant="quiet" loading={busy === "again"} disabled={busy !== null} onClick={onAgain}>
            Download again
          </Button>
        )}
        <Button size="md" variant="ghost" loading={busy === "delete"} disabled={busy !== null} onClick={onDelete}>
          Delete now
        </Button>
      </div>
    </div>
  );
}

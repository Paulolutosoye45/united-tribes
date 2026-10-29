"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { myPageSaveAction } from "@/app/(app)/my/actions";
import { Button } from "@/components/ui/Button";
import { Choice } from "@/components/ui/Choice";
import { Input, Select, Textarea } from "@/components/ui/Input";
import type { PageDetail } from "@/lib/profile/types";
import { CLASS_WORDS, MONTH_NAMES, SAVED_WORDS, SAVE_FAILURES, monthDay } from "@/lib/profile/wording";

/** Longer lines of the person's own words are written in a larger box; a name or a short line has one row. */
const BOX_FROM = 100;

const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"));
const MONTHS = MONTH_NAMES.map((name, i) => ({ value: String(i + 1).padStart(2, "0"), name }));

/**
 * The facts a person types or picks, and the lines of their own story: one card each. Each is saved the moment its button is pressed (the database checks
 * it), and an empty value clears it. The card says in words what saving does, so nobody is surprised.
 */
export function MyDetails({ items, testPrefix }: { items: PageDetail[]; testPrefix: "details" | "story" }) {
  return (
    <div className="flex flex-col gap-4" data-testid={`my-${testPrefix}`}>
      {items.map((d) => (
        <Editor key={d.key} d={d} />
      ))}
    </div>
  );
}

function Editor({ d }: { d: PageDetail }) {
  const router = useRouter();
  const id = `my-${d.key}`;
  const [draft, setDraft] = useState(d.value);
  // When the page is refreshed after a save, start again from what the database now holds (and keep the "Saved." line that was just said)
  const [seen, setSeen] = useState(d.value);
  if (seen !== d.value) {
    setSeen(d.value);
    setDraft(d.value);
  }
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  const chosen = d.kind === "gifts" ? draft.split(",").filter(Boolean) : [];
  const limit = d.limit ?? 3;
  const changed = draft.trim() !== d.value;

  async function send(value: string, kind: "save" | "clear") {
    if (busy) return;
    setBusy(kind);
    setError(null);
    setSaid(null);
    try {
      const out = await myPageSaveAction(d.key, value);
      if (out.ok) {
        setSaid(SAVED_WORDS[out.outcome]);
        if (out.outcome === "cleared") setDraft("");
        router.refresh();
      } else {
        setError(out.message ?? SAVE_FAILURES[out.reason] ?? SAVE_FAILURES.unknown);
      }
    } catch {
      setError("We couldn’t save that. Check your connection and try again.");
    }
    setBusy(null);
  }

  return (
    <section className="card flex flex-col gap-4 p-6" aria-labelledby={`${id}-h`} data-testid={id}>
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-h`} className="t-heading">
          {d.label}
        </h2>
        <p className="t-small text-soft">{d.question}</p>
      </div>

      {d.kind === "text" ? (
        d.max !== null && d.max >= BOX_FROM ? (
          <Textarea label={d.label} className="min-h-28" value={draft} maxLength={d.max} onChange={(e) => setDraft(e.target.value)} hint={`${draft.length} of ${d.max}`} data-testid={`${id}-input`} />
        ) : (
          <Input label={d.label} value={draft} maxLength={d.max ?? 300} onChange={(e) => setDraft(e.target.value)} hint={d.max ? `${draft.length} of ${d.max}` : undefined} data-testid={`${id}-input`} />
        )
      ) : null}

      {d.kind === "choice" ? (
        <Select label={d.label} value={draft} onChange={(e) => setDraft(e.target.value)} data-testid={`${id}-input`}>
          {draft === "" ? <option value="">Choose one</option> : null}
          {d.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ) : null}

      {d.kind === "monthday" ? (
        <div className="grid grid-cols-[1fr_8rem] gap-3">
          <Select label="Month" value={draft.split("-")[0] ?? ""} onChange={(e) => setDraft(e.target.value ? `${e.target.value}-${draft.split("-")[1] || "01"}` : "")} data-testid={`${id}-month`}>
            <option value="">Month</option>
            {MONTHS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.name}
              </option>
            ))}
          </Select>
          <Select label="Day" value={draft.split("-")[1] ?? ""} disabled={!draft} onChange={(e) => setDraft(`${draft.split("-")[0]}-${e.target.value}`)} data-testid={`${id}-day`}>
            {DAYS.map((day) => (
              <option key={day} value={day}>
                {Number(day)}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      {d.kind === "gifts" ? (
        <fieldset className="flex flex-col gap-2" data-testid={`${id}-input`}>
          <legend className="mb-1 text-[0.95rem] font-medium">
            Choose up to {limit}. {chosen.length} chosen.
          </legend>
          {d.options.map((o) => {
            const on = chosen.includes(o.value);
            return (
              <Choice
                key={o.value}
                type="checkbox"
                name={`${id}-gift`}
                value={o.value}
                checked={on}
                disabled={!on && chosen.length >= limit}
                title={o.label}
                description={o.detail ?? undefined}
                onChange={() => setDraft((on ? chosen.filter((g) => g !== o.value) : [...chosen, o.value]).join(","))}
              />
            );
          })}
        </fieldset>
      ) : null}

      <p className="t-small text-soft">{CLASS_WORDS[d.changeClass]}</p>
      {d.kind === "monthday" && d.value ? <p className="t-small text-soft">Saved as {monthDay(d.value)}. Only the day and the month are kept, never the year.</p> : null}

      <div className="flex flex-wrap gap-3">
        <Button size="lg" loading={busy === "save"} disabled={busy !== null || !changed || draft.trim() === ""} onClick={() => void send(draft, "save")} data-testid={`${id}-save`}>
          Save
        </Button>
        {d.value ? (
          <Button size="lg" variant="ghost" loading={busy === "clear"} disabled={busy !== null} onClick={() => void send("", "clear")} data-testid={`${id}-clear`}>
            Clear
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="t-small rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-danger" data-testid={`${id}-error`}>
          {error}
        </p>
      ) : null}
      {said ? (
        <p role="status" className="t-small rounded-[var(--radius-control)] bg-gold/20 px-4 py-3" data-testid={`${id}-saved`}>
          {said}
        </p>
      ) : null}
    </section>
  );
}

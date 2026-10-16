import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { HIDDEN_NOTE, type Move } from "@/lib/activity/format";

/** Shown when the database says no (the console locked in the meantime) or cannot be reached. It says nothing more. */
export function Unavailable() {
  return <p className="card t-body p-6 text-soft">This could not load. Try again in a moment.</p>;
}

export function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-heading`} className="t-heading">
          {title}
        </h2>
        {intro ? <p className="t-body measure text-soft">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** One number with how it moved from the period before. */
export function Tile({ label, value, move, note, href }: { label: string; value: string; move?: Move; note?: string; href?: string }) {
  const body = (
    <>
      <p className="t-small text-soft">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums" style={{ letterSpacing: "-0.02em" }}>
        {value}
      </p>
      {move?.text ? <p className={cn("t-small mt-1", move.dir === "up" ? "text-success" : "text-soft")}>{move.text}</p> : null}
      {note ? <p className="t-small mt-1 text-soft">{note}</p> : null}
    </>
  );
  return href ? (
    <Link href={href} className="card press block p-5">
      {body}
    </Link>
  ) : (
    <div className="card p-5">{body}</div>
  );
}

export function SmallGroupNote() {
  return <p className="t-small text-soft">{HIDDEN_NOTE} Young members are counted in totals but never named.</p>;
}

/** A simple table card. `head` and each row are plain text cells. */
export function DataTable({ caption, head, rows, empty }: { caption: string; head: string[]; rows: ReactNode[][]; empty?: string }) {
  if (rows.length === 0) return <p className="card t-body p-6 text-soft">{empty ?? "Nothing to show yet."}</p>;
  return (
    <div className="card overflow-x-auto p-4 sm:p-5">
      <table className="t-small w-full min-w-[20rem] text-left [font-variant-numeric:tabular-nums]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-soft">
            {head.map((h) => (
              <th key={h} scope="col" className="py-1 pr-4 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-line align-top">
              {row.map((cell, j) =>
                j === 0 ? (
                  <th key={j} scope="row" className="py-1.5 pr-4 font-normal">
                    {cell}
                  </th>
                ) : (
                  <td key={j} className="py-1.5 pr-4">
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

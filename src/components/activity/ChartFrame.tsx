"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * A card around one chart. The same numbers are always available as a table, one press away (for screen readers, for
 * copying, and for anyone who prefers a table). The caption is a plain sentence written from the same numbers.
 */
export function ChartFrame({ title, caption, chart, table }: { title: string; caption?: string; chart: ReactNode; table: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  const id = useId();
  return (
    <figure className="card flex flex-col gap-4 p-5 sm:p-6" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 id={`${id}-title`} className="t-heading">
          {title}
        </h3>
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          aria-pressed={asTable}
          className="btn btn-quiet h-9 rounded-full px-4 text-[0.85rem] font-medium"
        >
          {asTable ? "Show as chart" : "Show as table"}
        </button>
      </div>
      <div hidden={asTable}>{chart}</div>
      <div hidden={!asTable} className="overflow-x-auto">
        {table}
      </div>
      {caption ? <figcaption className="t-small text-soft">{caption}</figcaption> : null}
    </figure>
  );
}

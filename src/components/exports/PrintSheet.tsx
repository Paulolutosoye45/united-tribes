import { displayCell, isNumeric } from "@/lib/exports/display";
import { lagosDay, type Table, type Workbook } from "@/lib/exports/model";
import { LANE_NAMES } from "@/lib/exports/registry";

const day = (d: Date) => new Date(d.getTime() + 3_600_000).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/**
 * A file as a printed page: the same typed tables the spreadsheet is made from, laid out for A4. Because it is the same model, the
 * page, the spreadsheet and the data dictionary cannot say different things. The header of a table repeats on each page, a row is never
 * split across two, and a line at the foot of every page names the file, so a loose sheet can be traced back.
 */
export function PrintSheet({ workbook: w }: { workbook: Workbook }) {
  const lane = LANE_NAMES[w.lane];
  const wide = w.tables.some((t) => t.columns.length > 7);
  return (
    <article className="print-sheet" data-testid="print-sheet" data-pack={w.pack}>
      <style>{`
        .print-sheet { --rule: #cfcdc6; color: var(--ink); }
        .print-sheet table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
        .print-sheet th { text-align: left; font-weight: 600; background: color-mix(in srgb, var(--ink) 7%, transparent); border-bottom: 1.5px solid var(--ink); padding: 6px 8px; vertical-align: bottom; }
        .print-sheet td { padding: 5px 8px; border-bottom: 1px solid var(--rule); vertical-align: top; overflow-wrap: anywhere; }
        .print-sheet .num { text-align: right; font-variant-numeric: tabular-nums; }
        .print-sheet .grid td, .print-sheet .grid th { border: 1px solid var(--ink); }
        .print-sheet .grid td { height: 26px; }
        .print-sheet .table-wrap { overflow-x: auto; }
        .print-foot { display: none; }
        @media print {
          @page { size: A4 ${wide ? "landscape" : "portrait"}; margin: 14mm 12mm 18mm; }
          .print-sheet { --rule: #bbb; color: #000; }
          .print-sheet .table-wrap { overflow: visible; }
          .print-sheet thead { display: table-header-group; }
          .print-sheet tr { break-inside: avoid; }
          .print-sheet h2 { break-after: avoid; }
          .print-sheet .block { break-inside: auto; }
          .print-foot { display: flex; position: fixed; bottom: 0; left: 0; right: 0; justify-content: space-between; gap: 12px; font-size: 0.7rem; color: #444; border-top: 1px solid #999; padding-top: 4px; }
          .print-sheet .banner { border: 1.5px solid #000 !important; background: #fff !important; }
        }
      `}</style>

      <header className="flex flex-col gap-1 border-b-2 border-ink pb-4">
        <p className="t-small font-semibold uppercase tracking-wide text-soft">United Tribes · {w.packName}</p>
        <h1 className="t-title">{w.title}</h1>
        {w.subtitle ? <p className="t-body text-soft">{w.subtitle}</p> : null}
      </header>

      {w.rehearsal ? (
        <p className="banner mt-4 rounded-[var(--radius-control)] bg-gold/30 px-4 py-3 text-[0.95rem] font-semibold" role="note">
          REHEARSAL: this page was made while the pack is being tried by a few people. Please do not rely on it or pass it on.
        </p>
      ) : null}
      {w.lane === "people" ? (
        <p className="banner mt-4 rounded-[var(--radius-control)] bg-surface-strong px-4 py-3 text-[0.9rem]" role="note">
          {lane.name} file. This page names people. It is for the church’s own use: keep it private, do not send it to another platform, and shred it when you no longer need it.
        </p>
      ) : null}

      <dl className="mt-5 grid gap-x-8 gap-y-1 text-[0.88rem] sm:grid-cols-2">
        {w.facts.map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="w-36 shrink-0 font-semibold">{k}</dt>
            <dd className="text-soft print:text-black">{v}</dd>
          </div>
        ))}
      </dl>

      {w.tables.map((t) => (
        <section key={t.id} className="block mt-8 flex flex-col gap-2" aria-labelledby={`h-${t.id}`}>
          <div>
            <h2 id={`h-${t.id}`} className="t-heading">
              {t.title}
            </h2>
            {t.caption ? <p className="t-small text-soft print:text-black">{t.caption}</p> : null}
          </div>
          <TableView table={t} />
        </section>
      ))}

      {w.notes.length > 0 ? (
        <section className="block mt-8" aria-labelledby="h-notes">
          <h2 id="h-notes" className="t-heading">
            About this page
          </h2>
          <ul className="t-small mt-2 flex list-disc flex-col gap-1 pl-5">
            {w.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="print-foot" aria-hidden="true">
        <span>
          United Tribes · {w.packName} · file {w.exportId.slice(0, 8)}
          {w.rehearsal ? " · REHEARSAL" : ""}
        </span>
        <span>
          {lagosDay(w.made)} · {w.by}
        </span>
      </footer>
      <p className="no-print t-small mt-8 text-soft">
        Made {day(w.made)} for {w.by}. File {w.exportId.slice(0, 8)}.
      </p>
    </article>
  );
}

function TableView({ table: t }: { table: Table }) {
  if (t.rows.length === 0) return <p className="t-small text-soft print:text-black">Nothing to list here.</p>;
  return (
    <div className="table-wrap">
      <table className={t.grid ? "grid" : undefined}>
        <thead>
          <tr>
            {t.columns.map((c) => (
              <th key={c.key} scope="col" className={isNumeric(c.type) ? "num" : undefined} style={c.width && t.grid ? { minWidth: `${Math.min(c.width, 30)}ch` } : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((row, i) => (
            <tr key={i}>
              {t.columns.map((c, j) => (
                <td key={c.key} className={isNumeric(c.type) ? "num" : undefined}>
                  {displayCell(row[j], c.type)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

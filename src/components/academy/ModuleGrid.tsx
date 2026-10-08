import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import type { ModuleSummary } from "@/lib/academy/types";

export function ModuleGrid({ modules }: { modules: ModuleSummary[] }) {
  return (
    <section id="modules" aria-labelledby="modules-heading" className="flex scroll-mt-24 flex-col gap-3">
      <h2 id="modules-heading" className="t-heading">
        Six modules
      </h2>
      <ol className="stagger grid gap-3 sm:grid-cols-2">
        {modules.map((m, i) => (
          <li key={m.slug} style={{ ["--i" as string]: i }}>
            <Link
              href={`/lead/academy/${m.slug}`}
              className="card press flex h-full flex-col gap-3 p-5 transition-shadow hover:shadow-[var(--shadow-pop)]"
              aria-label={`Module ${m.number}: ${m.title}. ${m.passed ? `Passed with ${m.best} percent` : m.opened ? "Started" : "Not started"}`}
            >
              <div className="flex items-center justify-between gap-3">
                <span aria-hidden="true" className="t-small grid h-8 w-8 place-items-center rounded-full bg-surface-strong font-bold">
                  {m.number}
                </span>
                {m.passed ? (
                  <Badge tone="gold">Passed · {m.best}%</Badge>
                ) : m.attempts > 0 ? (
                  <Badge tone="flame">Best {m.best}% · try again</Badge>
                ) : m.opened ? (
                  <Badge tone="outline">Started</Badge>
                ) : (
                  <Badge tone="outline">Not started</Badge>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <h3 className="font-semibold leading-snug">{m.title}</h3>
                <p className="t-small text-soft">{m.outcome}</p>
              </div>
              <p className="t-small mt-auto text-soft">{m.format}</p>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

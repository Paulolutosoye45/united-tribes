import Link from "next/link";
import { buttonClasses } from "@/components/ui/Button";
import type { PagePanel } from "@/lib/profile/types";

/**
 * One short panel for each role a person holds. It gives a word or a number and the way to the place that has the whole of it. It never shows another
 * person's detail: the database sends only counts and the person's own standing.
 */
export function MyPanels({ panels }: { panels: PagePanel[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2" data-testid="my-panels">
      {panels.map((p) => (
        <section key={p.key} className="card flex flex-col gap-4 p-6" aria-labelledby={`panel-${p.key}-h`} data-testid={`my-panel-${p.key}`}>
          <h2 id={`panel-${p.key}-h`} className="t-heading">
            {p.title}
          </h2>
          <dl className="flex flex-col gap-3">
            {p.lines.map((l) => (
              <div key={l.label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <dt className="t-small text-soft">{l.label}</dt>
                <dd className="font-semibold">{l.value}</dd>
              </div>
            ))}
          </dl>
          {p.link ? (
            <Link href={p.link.path} className={buttonClasses({ variant: "quiet", size: "md", className: "w-fit" })}>
              <span className="relative">{p.link.label}</span>
            </Link>
          ) : null}
        </section>
      ))}
    </div>
  );
}

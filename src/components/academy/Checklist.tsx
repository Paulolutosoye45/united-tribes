import Link from "next/link";
import { cn } from "@/lib/cn";
import { checklist } from "@/lib/academy/options";
import type { MyAcademy } from "@/lib/academy/types";

/** The conditions for certification, each with where it stands and a way in. */
export function Checklist({ my }: { my: MyAcademy }) {
  const rows = checklist(my);
  return (
    <section aria-labelledby="cert-heading" className="flex flex-col gap-3">
      <h2 id="cert-heading" className="t-heading">
        What certification needs
      </h2>
      <ol className="card flex flex-col px-5 py-4">
        {rows.map((row, i) => {
          const last = i === rows.length - 1;
          const current = !row.done && rows.slice(0, i).every((r) => r.done || r.id === "practice" || r.id === "card");
          return (
            <li key={row.id} className="relative flex gap-4 pb-5 last:pb-0">
              {!last ? <span aria-hidden="true" className={cn("absolute left-[0.8rem] top-8 h-[calc(100%-1.75rem)] w-0.5 rounded-full", row.done ? "bg-gold" : "bg-line")} /> : null}
              <span
                aria-hidden="true"
                className={cn(
                  "relative grid h-[1.65rem] w-[1.65rem] shrink-0 place-items-center rounded-full border-2 text-[0.75rem] font-bold",
                  row.done && "border-transparent bg-gold text-on-flame",
                  !row.done && current && "border-flame bg-flame text-on-flame",
                  !row.done && !current && "border-line bg-raised text-soft",
                )}
              >
                {row.done ? "✓" : i + 1}
              </span>
              <div className="min-w-0 flex-1 pt-px">
                <p className={cn("font-semibold leading-snug", !row.done && !current && "text-soft")}>
                  {row.label}
                  <span className="sr-only">{row.done ? " (done)" : " (not yet)"}</span>
                </p>
                <p className="t-small text-soft">{row.detail}</p>
                {!row.done && (row.id === "card" || row.id === "declaration") && current ? (
                  <Link href={row.href} className="t-small mt-1 inline-block font-semibold underline underline-offset-4">
                    Open
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

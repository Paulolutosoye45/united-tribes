import Link from "next/link";
import type { Role } from "@/lib/auth/roles";
import { hasAnyRole } from "@/lib/auth/roles";
import type { Checklist as Data } from "@/lib/admin/types";
import { checkLine } from "@/lib/admin/wording";

/** What is still missing before a season can open. Each line points to the screen that fixes it, if the person may use it. */
export function Checklist({ checklist, roles }: { checklist: Data; roles: readonly Role[] }) {
  const lines = checklist.items.map((item) => ({ item, line: checkLine(item) }));
  const ready = lines.filter((l) => l.item.ok).length;
  const todo = lines.filter((l) => !l.item.ok);

  return (
    <section aria-labelledby="ready-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 id="ready-heading" className="t-heading">
          Before the season opens
        </h2>
        <p className="t-small text-soft" role="status">
          {ready} of {lines.length} ready
        </p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-strong" aria-hidden="true">
        <div className="h-full rounded-full bg-flame transition-[width] duration-500" style={{ width: `${Math.round((ready / lines.length) * 100)}%` }} />
      </div>
      {todo.length === 0 ? (
        <p className="card t-body p-5">Everything is in place. The season can open.</p>
      ) : (
        <ul className="card flex flex-col divide-y divide-line p-0">
          {todo.map(({ item, line }) => {
            const canOpen = hasAnyRole(roles, line.roles);
            const body = (
              <>
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">{line.title}</span>
                  <span className="t-small text-soft">{line.detail}</span>
                </span>
                {canOpen ? (
                  <span aria-hidden="true" className="text-soft">
                    →
                  </span>
                ) : null}
              </>
            );
            return (
              <li key={item.key}>
                {canOpen ? (
                  <Link href={line.href} className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-surface">
                    {body}
                  </Link>
                ) : (
                  <div className="flex items-center justify-between gap-4 px-5 py-4">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {ready > 0 && todo.length > 0 ? (
        <details>
          <summary className="t-small cursor-pointer text-soft">{ready} done</summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {lines
              .filter((l) => l.item.ok)
              .map(({ item, line }) => (
                <li key={item.key} className="t-small flex gap-2 text-soft">
                  <span aria-hidden="true">✓</span>
                  <span>
                    {line.title}. {line.detail}
                  </span>
                </li>
              ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

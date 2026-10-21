import type { Metadata } from "next";
import Link from "next/link";
import { NeedsAttention } from "@/components/admin/NeedsAttention";
import { loadAttention } from "@/lib/admin/notices-server";
import { canOpenDashboard, hatsOf, noticeWarnings, shortcutsFor } from "@/lib/admin/today";
import { OFFICE_ROLES, ROLE_LABELS } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { formatDate } from "@/lib/dates";

export const metadata: Metadata = { title: "Admin" };

const figure = (n: number) => n.toLocaleString("en");

/**
 * Today: what is waiting for the person signed in, and nothing else. Someone who holds more than one role (an admin who is also a pastor)
 * gets one page, with the work of every role they hold, each kind once, the most urgent first. Every other Admin page is in the menu.
 */
export default async function AdminPage() {
  const session = await requireRole(OFFICE_ROLES, "/admin");
  const att = await loadAttention();
  const hats = hatsOf(session.roles);
  const shortcuts = shortcutsFor(session.roles);
  const warnings = att ? noticeWarnings(att) : [];
  const roleWords = hats.map((r) => ROLE_LABELS[r].toLowerCase());

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">Today</h1>
        <p className="t-body measure text-soft">
          {hats.length > 1
            ? `What is waiting for you as ${roleWords.slice(0, -1).join(", ")} and ${roleWords[roleWords.length - 1]}, in one list. Everything else is in the menu.`
            : "What is waiting for you. Everything else is in the menu."}
        </p>
      </header>

      {att ? (
        <NeedsAttention rows={att.rows} roles={session.roles} />
      ) : (
        <p role="alert" className="card t-body p-6 text-soft" data-testid="attention-failed">
          We couldn’t load what is waiting. The menu still works. Try again in a moment.
        </p>
      )}

      {warnings.length > 0 ? (
        <section aria-labelledby="warnings-heading" className="flex flex-col gap-3" data-testid="notice-warnings">
          <h2 id="warnings-heading" className="t-heading">
            Team emails
          </h2>
          <ul className="flex flex-col gap-2">
            {warnings.map((w) => (
              <li key={w.text}>
                <Link href={w.href} className="card press flex min-h-11 items-center justify-between gap-4 p-4 hover:bg-surface">
                  <span className="t-body">{w.text}</span>
                  <span aria-hidden="true" className="text-soft">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {att && att.coming.length > 0 ? (
        <section aria-labelledby="coming-heading" className="flex flex-col gap-3" data-testid="coming-up">
          <h2 id="coming-heading" className="t-heading">
            Coming up
          </h2>
          <ul className="card flex flex-col divide-y divide-line p-0">
            {att.coming.map((c) => {
              const body = (
                <>
                  <span className="font-medium">{c.label}</span>
                  <span className="t-small text-soft">{formatDate(c.on)}</span>
                </>
              );
              return (
                <li key={`${c.label}-${c.on}`}>
                  {c.href ? (
                    <Link href={c.href} className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 hover:bg-surface">
                      {body}
                    </Link>
                  ) : (
                    <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {shortcuts.length > 0 ? (
        <section aria-labelledby="shortcuts-heading" className="flex flex-col gap-3 lg:hidden" data-testid="shortcuts">
          <h2 id="shortcuts-heading" className="t-heading">
            Shortcuts
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {shortcuts.map((s) => (
              <li key={s.href}>
                <Link href={s.href} className="card press flex min-h-14 items-center justify-between gap-3 p-4 font-semibold hover:bg-surface">
                  {s.label}
                  <span aria-hidden="true" className="text-soft">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {att?.numbers ? (
        <section aria-labelledby="numbers-heading" className="flex flex-col gap-3" data-testid="numbers">
          <h2 id="numbers-heading" className="t-heading">
            Numbers
          </h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Members placed", att.numbers.placed],
              ["Applications this month", att.numbers.applicationsMonth],
              ["Leaders certified", att.numbers.certified],
              ["Tribes open", att.numbers.tribesOpen],
            ].map(([label, n]) => (
              <div key={label} className="card flex flex-col gap-0.5 p-4">
                <dt className="t-small text-soft">{label}</dt>
                <dd className="text-2xl font-semibold">{figure(n as number)}</dd>
              </div>
            ))}
          </dl>
          <p className="flex flex-wrap gap-x-6">
            <Link href="/admin/figures" className="press inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
              More figures
            </Link>
            {canOpenDashboard(session.roles) ? (
              <Link href="/dashboard" className="press inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
                See the full dashboard
              </Link>
            ) : null}
          </p>
        </section>
      ) : null}
    </div>
  );
}

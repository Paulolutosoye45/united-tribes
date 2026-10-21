import type { Metadata } from "next";
import { ModeSwitch } from "@/components/admin/ModeSwitch";
import { PageHead } from "@/components/admin/PageHead";
import { Badge } from "@/components/ui/Badge";
import { loadNoticeLog, loadNoticeOverview } from "@/lib/admin/notices-server";
import { DELIVERY_WORDS, logStatus, noticeTitle, noticesOf, type NoticeGroupState } from "@/lib/admin/notices";
import { previewOf, type Preview } from "@/lib/admin/notice-preview";
import { OFFICE_ROLES, ROLE_LABELS, isRole } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { formatLagosDay, formatLagosTime } from "@/lib/dates";
import { NOTICE_CATALOGUE, NOTICE_GROUPS } from "@/lib/messaging/templates-notices";

export const metadata: Metadata = { title: "Notifications" };

const roleName = (r: string) => (isRole(r) ? ROLE_LABELS[r].toLowerCase() : r.replace(/_/g, " "));

function PreviewBox({ p }: { p: Preview }) {
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-line bg-page p-4" data-testid="notice-preview">
      <p className="t-small text-soft">
        Subject: <span className="font-semibold text-ink">{p.subject}</span>
      </p>
      {p.greeting ? <p className="font-semibold">{p.greeting}</p> : null}
      {p.paragraphs.map((t) => (
        <p key={t} className="t-body">
          {t}
        </p>
      ))}
      {p.sections.map((s) => (
        <div key={s.title} className="flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-soft">{s.title}</p>
          <ul className="flex flex-col gap-1">
            {s.items.map((i) => (
              <li key={i.label} className="t-small">
                {i.label}
                {i.note ? <span className="text-soft"> · {i.note}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {p.button ? (
        <p className="t-small">
          Button: <span className="rounded-full bg-flame px-3 py-1 font-semibold text-on-flame">{p.button.label}</span> <span className="text-soft">opens {p.button.path}</span>
        </p>
      ) : (
        <p className="t-small text-soft">No button: this one goes to an address we only know for this purpose.</p>
      )}
    </div>
  );
}

function GroupCard({ meta, state, canEdit }: { meta: (typeof NOTICE_GROUPS)[number]; state: NoticeGroupState; canEdit: boolean }) {
  const notices = noticesOf(meta.key);
  const people = state.people;
  return (
    <li className="card flex flex-col gap-4 p-5" data-testid={`group-${meta.key}`}>
      <header className="flex flex-col gap-1">
        <h3 className="t-heading">{meta.label}</h3>
        <p className="t-small text-soft">{meta.who}.</p>
        <p className="t-small">{meta.note}</p>
      </header>

      <ModeSwitch group={meta.key} label={meta.label} mode={state.mode} canEdit={canEdit} />

      {people ? (
        <div className="flex flex-col gap-2" data-testid={`people-${meta.key}`}>
          {people.length === 0 ? (
            <p role="status" className="t-small rounded-[var(--radius-control)] bg-flame/10 px-4 py-3">
              No one holds this role in this centre, so no one would receive these. Give the role to someone on the People and roles page.
            </p>
          ) : (
            <>
              <p className="t-small font-medium">
                {people.length} {people.length === 1 ? "person receives" : "people receive"} these
              </p>
              <ul className="flex flex-col divide-y divide-line">
                {people.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 t-small">
                    <span>
                      {p.name} <span className="text-soft">({roleName(p.role)})</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-soft">
                      {p.canBeTold ? null : <Badge tone="flame">No valid email</Badge>}
                      {meta.digest ? DELIVERY_WORDS[p.delivery] : null}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}

      <details className="group">
        <summary className="press inline-flex min-h-11 cursor-pointer items-center font-semibold underline underline-offset-4">
          The {notices.length} {notices.length === 1 ? "notice" : "notices"} in this group
        </summary>
        <ul className="mt-2 flex flex-col gap-3">
          {notices.map((n) => {
            const preview = previewOf(n.key);
            return (
              <li key={n.key} className="flex flex-col gap-1 rounded-[var(--radius-control)] border border-line p-3" data-testid={`notice-${n.key}`}>
                <p className="font-medium">
                  {n.title} {n.urgent ? <Badge tone="flame">At once</Badge> : null}
                </p>
                <p className="t-small text-soft">Sent: {n.when}.</p>
                {preview ? (
                  <details>
                    <summary className="press inline-flex min-h-11 cursor-pointer items-center t-small font-semibold underline underline-offset-4">How it reads</summary>
                    <PreviewBox p={preview} />
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      </details>
    </li>
  );
}

export default async function NotificationsPage() {
  await requireRole(OFFICE_ROLES, "/admin/notifications");
  const [overview, log] = await Promise.all([loadNoticeOverview(), loadNoticeLog(50)]);
  const digest = NOTICE_CATALOGUE.find((n) => n.key === "staff_digest");
  const digestPreview = previewOf("staff_digest");

  return (
    <div className="flex flex-col gap-10">
      <PageHead title="Notifications">
        The emails the team gets when something needs them, so no one has to sign in to find out. Every group starts <strong>Off</strong>. <strong>Rehearsal</strong> writes to the log what would be sent, and emails no one. <strong>On</strong> sends.
      </PageHead>

      {overview ? (
        <>
          <section aria-labelledby="how-heading" className="card flex flex-col gap-3 p-5">
            <h2 id="how-heading" className="t-heading">
              How it works
            </h2>
            <ul className="t-body flex list-disc flex-col gap-1 pl-5">
              <li>A notice goes to the people who hold a role in this centre, and stops the day the role is taken away.</li>
              <li>
                Someone who holds more than one role (an admin who is also a pastor) gets one email for each thing that happens, never two, and one summary with a part for each role.
              </li>
              <li>
                Admins, pastors, directors, the care team and coaches get a {digest ? "daily summary" : "summary"} by default, between 7 am and 8 pm. Each person can choose right away, daily or weekly under <strong>My notices</strong> in their profile. A referee’s concern, a deletion request near its deadline, stuck messages and a new role are sent right away, whatever they chose.
              </li>
              <li>Nothing here names a person in need, carries a note, a score or a referee’s words, or concerns a young member. Emails point to the page where the thing is done.</li>
              <li>Nothing is sent between 10 pm and 6 am, Lagos time. Whatever comes up overnight goes out in the morning.</li>
            </ul>
            {digestPreview ? (
              <details>
                <summary className="press inline-flex min-h-11 cursor-pointer items-center font-semibold underline underline-offset-4">How the summary reads</summary>
                <PreviewBox p={digestPreview} />
              </details>
            ) : null}
          </section>

          <section aria-labelledby="groups-heading" className="flex flex-col gap-4">
            <h2 id="groups-heading" className="t-heading">
              Groups
            </h2>
            <ul className="grid gap-4 lg:grid-cols-2">
              {NOTICE_GROUPS.map((meta) => {
                const state = overview.groups.find((g) => g.key === meta.key);
                return state ? <GroupCard key={meta.key} meta={meta} state={state} canEdit={overview.canEdit} /> : null;
              })}
            </ul>
          </section>

          <section aria-labelledby="log-heading" className="flex flex-col gap-3">
            <h2 id="log-heading" className="t-heading">
              The last {log.length === 1 ? "notice" : `${Math.min(log.length, 50)} notices`}
            </h2>
            {log.length === 0 ? (
              <p className="card t-body p-5 text-soft" data-testid="log-empty">
                Nothing yet. Switch a group to Rehearsal to see what it would send.
              </p>
            ) : (
              <ul className="card flex flex-col divide-y divide-line p-0" data-testid="notice-log">
                {log.map((r) => {
                  const s = logStatus(r);
                  return (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3" data-testid={`log-${r.template}`}>
                      <span className="min-w-0 flex-1 basis-56">
                        <span className="font-medium">{noticeTitle(r.template)}</span>
                        <span className="t-small block text-soft">
                          To {r.to || "someone"} · {formatLagosDay(r.at)}, {formatLagosTime(r.at)}
                        </span>
                      </span>
                      <span className={`t-small font-semibold ${s.tone === "bad" ? "text-danger" : s.tone === "ok" ? "text-success" : "text-soft"}`}>{s.label}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="faults-heading" className="flex flex-col gap-3">
            <h2 id="faults-heading" className="t-heading">
              Notices that could not be queued
            </h2>
            {overview.faults.length === 0 ? (
              <p className="card t-body p-5 text-soft">None. A fault here never stops the thing that caused it; it is only listed.</p>
            ) : (
              <ul className="card flex flex-col divide-y divide-line p-0" data-testid="notice-faults">
                {overview.faults.map((f, i) => (
                  <li key={`${f.at}-${i}`} className="px-5 py-3 t-small">
                    <span className="font-medium">{f.source}</span> <span className="text-soft">· {f.at ? `${formatLagosDay(f.at)}, ${formatLagosTime(f.at)}` : ""}</span>
                    <span className="block text-soft">{f.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <details className="card p-5">
            <summary className="press inline-flex min-h-11 cursor-pointer items-center font-semibold">The numbers the checks use</summary>
            <dl className="mt-3 flex flex-col gap-3">
              {overview.numbers.map((n) => (
                <div key={n.key} className="flex flex-col gap-0.5">
                  <dt className="t-small font-medium">
                    {n.value} <span className="text-soft">· {n.key.replace(/_/g, " ")}</span>
                  </dt>
                  <dd className="t-small text-soft">{n.note}</dd>
                </div>
              ))}
            </dl>
            <p className="t-small mt-3 text-soft">These change with a database update, not on this page.</p>
          </details>
        </>
      ) : (
        <p role="alert" className="card t-body p-6 text-soft">
          We couldn’t load the notifications. Try again in a moment.
        </p>
      )}
    </div>
  );
}

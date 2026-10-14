"use client";

import Link from "next/link";
import { useState } from "react";
import { saveSettingsAction, setJourneyModeAction, setMasterAction } from "@/app/(app)/admin/reminders/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { formatLagosDay, formatLagosTime } from "@/lib/dates";
import { JOURNEYS, MODES, NOT_SEASON_REASONS } from "@/lib/outreach/labels";
import type { JourneyOverview, RemindersOverview } from "@/lib/outreach/types";

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);
const hour = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "am" : "pm"}`;
const field = "h-12 w-full rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base focus:border-ink focus:outline-none";

function ModeSwitch({ j, canChange }: { j: JourneyOverview; canChange: boolean }) {
  const d = useDo();
  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label={`${JOURNEYS[j.key]?.short ?? j.title}: mode`} className="grid grid-cols-3 gap-1 rounded-full bg-surface p-1">
        {(Object.keys(MODES) as (keyof typeof MODES)[]).map((m) => {
          const on = j.mode === m;
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!canChange || d.busy !== null}
              onClick={() => (on ? undefined : void d.go(m, () => setJourneyModeAction(j.key, m), { saved: m === "on" ? "On. It will write to real people from now." : m === "rehearsal" ? "Rehearsal: it logs what it would send and sends nothing." : "Off." }))}
              className={`press min-h-11 rounded-full px-2 text-[0.9rem] font-semibold transition-colors ${on ? (m === "on" ? "bg-flame text-white" : "bg-ink text-page") : "text-ink hover:bg-surface-strong"} disabled:opacity-60`}
            >
              {MODES[m].label}
            </button>
          );
        })}
      </div>
      <p className="t-small text-soft">{MODES[j.mode].hint}</p>
      <Notice error={d.error} saved={d.saved} />
    </div>
  );
}

function Holdout({ j }: { j: JourneyOverview }) {
  const t = j.treated;
  const h = j.holdout;
  if (t.people < 20 || h.people < 5) {
    return <p className="t-small text-soft">Too early to tell if the reminders help. We compare people who were written to with a small group who were left alone, once there are enough of both.</p>;
  }
  const a = pct(t.acted, t.people);
  const b = pct(h.acted, h.people);
  return (
    <p className="t-small" data-testid="holdout">
      Within two weeks, <strong>{a}%</strong> of the {t.people} written to went on to act, against <strong>{b}%</strong> of the {h.people} left alone on purpose.{" "}
      <span className="text-soft">{a - b >= 5 ? "The reminders are helping." : a - b <= -5 ? "They are not helping here; read the emails again." : "No clear difference yet."}</span>
    </p>
  );
}

function JourneyCard({ j, canChange }: { j: JourneyOverview; canChange: boolean }) {
  const meta = JOURNEYS[j.key];
  const stopped = j.unsub_30d + j.complaints_30d;
  const reasons = Object.entries(j.reasons).filter(([, n]) => n > 0);
  return (
    <li className="card flex flex-col gap-4 p-5" data-testid={`journey-${j.key}`}>
      <header className="flex flex-col gap-1">
        <h3 className="t-heading">{meta?.title ?? j.title}</h3>
        <p className="t-small text-soft">
          {meta?.who} Stops when: {meta?.stops?.toLowerCase()}
        </p>
        <p className="t-small text-soft">
          Four emails, on days {j.day_offsets.join(", ")}.
        </p>
      </header>
      {j.paused_reason ? (
        <p role="alert" className="t-small rounded-[var(--radius-control)] bg-flame/10 px-4 py-3">
          <strong>It paused itself.</strong> {j.paused_reason} It will not start again on its own.
        </p>
      ) : null}
      <ModeSwitch j={j} canChange={canChange} />
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { l: j.mode === "rehearsal" ? "In rehearsal" : "In it now", v: j.active },
          { l: "Started, 30 days", v: j.entered_30d },
          { l: "Went on to act", v: j.acted_30d },
          { l: "Stopped emails", v: stopped },
        ].map((x) => (
          <div key={x.l} className="flex flex-col">
            <dt className="t-small text-soft">{x.l}</dt>
            <dd className="t-title">{x.v.toLocaleString("en")}</dd>
          </div>
        ))}
      </dl>
      {j.mode === "rehearsal" ? <p className="t-small text-soft">It has logged {j.rehearsal_would_send.toLocaleString("en")} emails it would have sent. Look at the log below, then switch it on when you are happy.</p> : null}
      <Holdout j={j} />
      {reasons.length > 0 ? (
        <p className="t-small text-soft">
          “Not this season”: {reasons.map(([k, n]) => `${n} ${NOT_SEASON_REASONS.find((r) => r.value === k)?.label.toLowerCase() ?? "no reason given"}`).join(", ")}.
        </p>
      ) : null}
      <div>
        <Link href={`/admin/reminders/${j.key}`} className="press inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
          Read and edit the four emails
        </Link>
      </div>
    </li>
  );
}

function Settings({ o }: { o: RemindersOverview }) {
  const s = o.settings;
  const d = useDo();
  const [v, setV] = useState({
    holdout_pct: String(s.holdout_pct),
    applications_close_on: s.applications_close_on ?? "",
    joining_closes_days: String(s.joining_closes_days),
    cap_gap_days: String(s.cap_gap_days),
    cap_reminders_week: String(s.cap_reminders_week),
    cap_nonessential_week: String(s.cap_nonessential_week),
    bulk_per_minute: String(s.bulk_per_minute),
    approval_threshold: String(s.approval_threshold),
    church_name: s.church_name,
    church_address: s.church_address,
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  const n = (x: string) => Number(x);
  const num = (label: string, k: keyof typeof v, note: string) => (
    <label className="flex flex-col gap-1">
      <span className="t-small font-medium">{label}</span>
      <input className={field} inputMode="numeric" value={v[k]} onChange={set(k)} disabled={!o.can_change} />
      <span className="t-small text-soft">{note}</span>
    </label>
  );
  return (
    <section aria-labelledby="settings-heading" className="flex flex-col gap-4">
      <h2 id="settings-heading" className="t-heading">
        Limits and details
      </h2>
      <div className="card flex flex-col gap-5 p-5">
        <p className="t-small text-soft">
          Reminders go out between {hour(s.reminder_start_hour)} and {hour(s.reminder_end_hour)} Lagos time, and not before {hour(s.sunday_start_hour)} on Sundays. Announcements go between {hour(s.bulk_start_hour)} and {hour(s.bulk_end_hour)}.
          Nothing goes out between 10 pm and 6 am.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {num("Left alone on purpose (%)", "holdout_pct", "A small group who are not reminded, so you can tell if reminding helps. 0 turns it off.")}
          {num("Most reminders a week, per person", "cap_reminders_week", "Across all four journeys.")}
          {num("Days between two reminders", "cap_gap_days", "Never closer than this.")}
          {num("Most emails of any kind a week", "cap_nonessential_week", "Reminders and announcements together. Tribe emails are separate.")}
          {num("Announcements a minute", "bulk_per_minute", "How fast an announcement is sent.")}
          {num("Second approver from this many people", "approval_threshold", "Below this, an announcement can be sent by its writer.")}
          {num("Days after the season starts that joining closes", "joining_closes_days", "Used in the last “no tribe yet” email.")}
          <label className="flex flex-col gap-1">
            <span className="t-small font-medium">Leader applications close on</span>
            <input type="date" className={field} value={v.applications_close_on} onChange={set("applications_close_on")} disabled={!o.can_change} />
            <span className="t-small text-soft">The last leader email moves to three days before. Leave empty if there is no date.</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="t-small font-medium">Church name in the email footer</span>
            <input className={field} value={v.church_name} maxLength={80} onChange={set("church_name")} disabled={!o.can_change} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="t-small font-medium">Church address in the footer</span>
            <input className={field} value={v.church_address} maxLength={160} onChange={set("church_address")} disabled={!o.can_change} />
            <span className="t-small text-soft">Email rules ask for a real postal address in every message. Check this one is right.</span>
          </label>
        </div>
        <Notice error={d.error} saved={d.saved} />
        {o.can_change ? (
          <div>
            <Button
              size="md"
              loading={d.busy === "settings"}
              onClick={() =>
                void d.go(
                  "settings",
                  () =>
                    saveSettingsAction({
                      holdout_pct: n(v.holdout_pct),
                      applications_close_on: v.applications_close_on || null,
                      joining_closes_days: n(v.joining_closes_days),
                      cap_gap_days: n(v.cap_gap_days),
                      cap_reminders_week: n(v.cap_reminders_week),
                      cap_nonessential_week: n(v.cap_nonessential_week),
                      bulk_per_minute: n(v.bulk_per_minute),
                      approval_threshold: n(v.approval_threshold),
                      church_name: v.church_name,
                      church_address: v.church_address,
                    }),
                  { saved: "Saved." },
                )
              }
            >
              Save
            </Button>
          </div>
        ) : (
          <p className="t-small text-soft">Only an admin or a director can change these.</p>
        )}
      </div>
    </section>
  );
}

export function ReminderBoard({ o }: { o: RemindersOverview }) {
  const d = useDo();
  const [confirmOff, setConfirmOff] = useState(false);
  const live = o.journeys.filter((j) => j.mode === "on").length;
  return (
    <div className="flex flex-col gap-10">
      <section className="night flex flex-col gap-4 rounded-[var(--radius-card)] p-5 sm:p-6" aria-labelledby="master-heading" data-testid="master">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="master-heading" className="t-heading">
              {o.settings.master_on ? (live > 0 ? `${live} of 4 journeys are sending` : "Nothing is sending yet") : "All automatic reminders are off"}
            </h2>
            <p className="t-small max-w-[56ch] text-white/75">
              The master switch stops everything automatic at once, whatever each journey says. Announcements are separate.
            </p>
          </div>
          {o.can_change ? (
            o.settings.master_on ? (
              confirmOff ? (
                <div className="flex gap-2">
                  <Button variant="night" size="md" loading={d.busy === "master"} onClick={() => void d.go("master", () => setMasterAction(false), { saved: "All reminders are off.", after: () => setConfirmOff(false) })}>
                    Yes, turn all off
                  </Button>
                  <Button variant="ghost" size="md" onClick={() => setConfirmOff(false)}>
                    Keep on
                  </Button>
                </div>
              ) : (
                <Button variant="night" size="md" onClick={() => setConfirmOff(true)}>
                  Turn all off
                </Button>
              )
            ) : (
              <Button size="md" loading={d.busy === "master"} onClick={() => void d.go("master", () => setMasterAction(true), { saved: "Reminders can run again. Each journey keeps its own setting." })}>
                Turn reminders on
              </Button>
            )
          ) : null}
        </div>
        <dl className="grid grid-cols-3 gap-3">
          {[
            { l: "Sent today", v: o.today.sent },
            { l: "Rehearsed today", v: o.today.rehearsed },
            { l: "Left out today", v: o.today.skipped },
          ].map((x) => (
            <div key={x.l}>
              <dt className="t-small text-white/70">{x.l}</dt>
              <dd className="t-title">{x.v.toLocaleString("en")}</dd>
            </div>
          ))}
        </dl>
        <Notice error={d.error} saved={d.saved} />
      </section>

      {o.asks_open > 0 && o.can_see_people ? (
        <p role="note" className="rounded-[var(--radius-control)] bg-gold/25 px-4 py-3">
          {o.asks_open === 1 ? "One person has" : `${o.asks_open} people have`} answered an email by asking for someone to reach out.{" "}
          <Link href="/care/asks" className="font-semibold underline underline-offset-4">
            See who
          </Link>
        </p>
      ) : null}

      <section aria-labelledby="journeys-heading" className="flex flex-col gap-4">
        <h2 id="journeys-heading" className="t-heading">
          The four journeys
        </h2>
        <ul className="grid gap-4 lg:grid-cols-2">
          {o.journeys.map((j) => (
            <JourneyCard key={j.key} j={j} canChange={o.can_change} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="log-heading" className="flex flex-col gap-3">
        <h2 id="log-heading" className="t-heading">
          What it has been doing
        </h2>
        {o.recent.length > 0 ? (
          <ul className="card divide-y divide-line">
            {o.recent.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="t-small">
                  <strong>{r.kind === "rehearsal" ? "Would send" : r.kind === "sent" ? "Sent" : "Left out"}</strong> email {r.step} of {JOURNEYS[r.journey]?.short.toLowerCase() ?? r.journey}
                  {r.who ? ` to ${r.who}` : ""}
                  {r.reason ? ` (${r.reason})` : ""}
                </span>
                <span className="t-small text-soft">{formatLagosDay(r.at)}, {formatLagosTime(r.at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="card t-body p-5 text-soft">Nothing yet. Once a journey is in rehearsal or on, it appears here, first names only.</p>
        )}
      </section>

      <Settings o={o} />
    </div>
  );
}
